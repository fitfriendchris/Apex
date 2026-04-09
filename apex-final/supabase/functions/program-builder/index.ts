// supabase/functions/program-builder/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// AGENT 2 — ProgramBuilder AI
// Generates a complete, periodized workout program tailored to a user's profile,
// tier, goals, and available equipment. Coaches can regenerate for any client.
//
// Deploy:
//   supabase functions deploy program-builder
//
// Secrets needed:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set ALLOWED_ORIGIN=https://apexcoaching.app
//
// Request body:
//   {
//     user: { firstName, age, sex, weight, height, goal, activity, transform, tier },
//     weeks?: number,          // default 4
//     equipment?: string,      // "full_gym" | "home" | "minimal"
//     focus?: string,          // optional override e.g. "upper body lagging"
//     clientEmail?: string,    // coach calling on behalf of a client
//   }
//
// Response:
//   { program: { name, weeks, focus, schedule[], days: [ { name, focus, exercises[] } ] } }
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://apexcoaching.app";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Tier access gates ─────────────────────────────────────────────────────────
const TIER_ALLOWED = new Set(["core", "elite", "vip", "diamond"]);

const SYSTEM_PROMPT = `You are an elite physique coach and certified strength & conditioning specialist. 
You build science-backed, periodized workout programs for aesthetic goals (Greek God physique, bikini model conditioning).

PROGRAMMING PRINCIPLES:
- Hypertrophy focus: 3–5 sets × 6–15 reps, 60–90s rest for most movements
- Progressive overload is the #1 rule — always program for it
- Compound movements first, isolation second
- 5-day Upper/Lower/Push/Pull/Legs is the default for advanced clients
- 4-day Upper/Lower split for intermediate; 3-day full-body for beginners
- Always include warm-up and cool-down notes
- Include RPE (Rate of Perceived Exertion) targets — keep most working sets at RPE 7–9
- For fat loss phases: maintain intensity, adjust volume slightly down
- For building phases: progressive volume increases each week

EXERCISE SELECTION RULES:
- Prioritise compound free-weight movements (squat, deadlift, bench, row, OHP)
- Include 1–2 isolation exercises per muscle group
- Always name the specific equipment variant (e.g., "Barbell Back Squat" not just "Squat")
- Provide a coaching tip per exercise (form cue or common mistake to avoid)

OUTPUT: Respond with ONLY valid JSON — no markdown, no commentary, just the JSON object below.

JSON SCHEMA:
{
  "name": "string — program name e.g. 'APEX 4-Week Hypertrophy Block'",
  "weeks": number,
  "phase": "string — 'cut' | 'bulk' | 'recomp' | 'maintain'",
  "frequency": "string — e.g. '5 days/week'",
  "schedule": ["string"] — e.g. ["Mon: Push", "Tue: Pull", "Wed: Legs", "Thu: Rest", "Fri: Upper", "Sat: Lower", "Sun: Rest"],
  "progressionRule": "string — how to add weight/reps each week",
  "days": [
    {
      "name": "string — e.g. 'Day 1 — Push (Chest / Shoulders / Triceps)'",
      "focus": "string — muscle groups",
      "warmup": "string — brief warm-up protocol",
      "exercises": [
        {
          "order": number,
          "name": "string — full exercise name",
          "sets": number,
          "reps": "string — e.g. '8–10' or '5' or '12–15'",
          "rest": "string — e.g. '90s'",
          "rpe": "string — e.g. 'RPE 8'",
          "tip": "string — 1 sentence coaching cue"
        }
      ],
      "cooldown": "string — brief cool-down / stretch focus"
    }
  ],
  "weeklyProgression": [
    { "week": number, "focus": "string", "volumeNote": "string" }
  ],
  "nutritionNote": "string — 1-2 sentences connecting this program to their macro targets"
}`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return jsonError("ANTHROPIC_API_KEY not configured", 500);

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const coachToken = req.headers.get("X-Coach-Token") ?? "";
  const isCoach = coachToken.length > 8 && coachToken === (Deno.env.get("COACH_SECRET") ?? "");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr && !isCoach) return jsonError("Unauthorized", 401);

  // ── Parse body ────────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonError("Invalid JSON", 400); }

  const { user: profile, weeks = 4, equipment = "full_gym", focus, clientEmail } = body as {
    user: {
      firstName: string; age: number; sex: string; weight: number; height: number;
      goal: string; activity: string; transform?: string; tier: string;
    };
    weeks?: number;
    equipment?: string;
    focus?: string;
    clientEmail?: string;
  };

  if (!profile) return jsonError("user profile is required", 400);

  // ── Tier gate: Core+ can access program builder ───────────────────────────────
  if (!isCoach && !TIER_ALLOWED.has(profile.tier)) {
    return jsonError("Program Builder requires Core tier or above", 403);
  }

  // ── Clamp weeks to a sane range ───────────────────────────────────────────────
  const safeWeeks = Math.min(Math.max(Number(weeks) || 4, 2), 12);

  // ── Rate limiting ─────────────────────────────────────────────────────────────
  const targetEmail = clientEmail || user?.email;
  if (targetEmail && !isCoach) {
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data: usageRow } = await supabase
        .from("daily_ai_usage").select("calls").eq("user_email", targetEmail).eq("date", today).single();
      const LIMITS: Record<string, number> = { core: 100, elite: 200, vip: 500, diamond: 9999 };
      const limit = LIMITS[profile.tier] ?? 0;
      const calls = (usageRow?.calls ?? 0) as number;
      if (calls >= limit) return jsonError(`Daily AI limit reached (${calls}/${limit})`, 429);
    } catch { /* table may not exist yet */ }
  }

  // ── Derive training level from activity ───────────────────────────────────────
  const trainingLevel =
    profile.activity === "sedentary" || profile.activity === "lightly_active" ? "beginner"
    : profile.activity === "moderately_active" ? "intermediate"
    : "advanced";

  const phase = profile.goal === "lose_weight" || profile.goal === "cutting"   ? "cut"
              : profile.goal === "build_muscle" || profile.goal === "bulking"   ? "bulk"
              : profile.goal === "maintain"                                      ? "maintain"
              : "recomp";

  // height is in inches — label it clearly in the prompt
  const heightDisplay = profile.height ? `${profile.height} inches` : "not specified";

  const userPrompt = `Build a ${safeWeeks}-week physique training program for this client:

Name: ${profile.firstName}
Age: ${profile.age} | Sex: ${profile.sex} | Weight: ${profile.weight} lbs | Height: ${heightDisplay}
Training level: ${trainingLevel}
Goal: ${phase.toUpperCase()} — ${profile.goal?.replace(/_/g, " ")}
Available equipment: ${String(equipment).replace(/_/g, " ")}
Current transformation goal: "${profile.transform ?? "General physique improvement"}"
${focus ? `Coach focus note: ${focus}` : ""}

Generate the complete ${safeWeeks}-week periodized program. Return only the JSON.`;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) return jsonError("AI program generation failed", 502);

    const aiData = await res.json();
    const rawText = aiData.content?.[0]?.text ?? "";

    let program: Record<string, unknown>;
    try {
      const cleaned = rawText.replace(/```json\n?|```\n?/g, "").trim();
      program = JSON.parse(cleaned);
    } catch {
      console.error("Program JSON parse failed:", rawText.slice(0, 500));
      return jsonError("Failed to parse AI program output", 422);
    }

    // ── Increment usage (non-fatal) ────────────────────────────────────────────
    if (targetEmail) {
      try {
        const today = new Date().toISOString().split("T")[0];
        await supabase.rpc("increment_ai_usage", { p_email: targetEmail, p_date: today });
      } catch { /* non-fatal */ }
    }

    return new Response(JSON.stringify({ program }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("program-builder error:", err);
    return jsonError("Internal server error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
