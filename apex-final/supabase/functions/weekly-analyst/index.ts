// supabase/functions/weekly-analyst/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// AGENT 3 — WeeklyAnalyst AI
// Deep analysis of a user's 7-day data: compliance, macro adherence, weight
// trend, training volume, and actionable calorie adjustments.
// Called by the app every Sunday or on-demand by coach/client.
//
// Deploy:
//   supabase functions deploy weekly-analyst
//
// Request body:
//   {
//     user:     { email, firstName, age, sex, weight, goalWeight, goal, tier, ... },
//     logs:     [ { date, foods[], checks{}, water, fast_start, fast_end } ],  // 7 days
//     checkIn?: { weight, energy, sleep, stress, perf, win, challenge, coachQ },
//     macros:   { calories, protein, carb, fat },
//     isCoach?: boolean
//   }
//
// Response:
//   { report: { weeklyScore, compliance, macroAdherence, weightTrend,
//               calorieAdjustment, insights[], coachMessage, clientSummary,
//               weekNumber, generatedAt } }
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

interface FoodEntry { name: string; calories: number; protein: number; fat: number; carb: number; }
interface DailyLog { date: string; foods: FoodEntry[]; checks: Record<string, boolean>; water: number; }
interface UserProfile {
  email: string; firstName: string; age: number; sex: string;
  weight: number; goalWeight: number; goal: string; tier: string;
  startWeight?: number; joinDate?: string;
}
interface MacroTargets { calories: number; protein: number; carb: number; fat: number; }
interface CheckIn {
  weight?: number; energy?: number; sleep?: number; stress?: number;
  perf?: number; win?: string; challenge?: string; coachQ?: string;
}

// ── Compute data summaries before sending to AI ───────────────────────────────
function summariseLogs(logs: DailyLog[], macros: MacroTargets) {
  const days = logs.length || 1;
  let totalChecks = 0, maxChecks = 0;
  let totalCalories = 0, totalProtein = 0;
  let loggedDays = 0;
  const calsByDay: number[] = [];
  const checksByDay: number[] = [];

  for (const log of logs) {
    const checks = Object.values(log.checks || {}).filter(Boolean).length;
    totalChecks += checks;
    maxChecks += 8;
    checksByDay.push(checks);

    const cals = (log.foods || []).reduce((a, f) => a + (+f.calories || 0), 0);
    const prot = (log.foods || []).reduce((a, f) => a + (+f.protein  || 0), 0);
    if (log.foods?.length > 0) { loggedDays++; totalCalories += cals; totalProtein += prot; }
    calsByDay.push(cals);
  }

  const avgCals    = loggedDays > 0 ? Math.round(totalCalories / loggedDays) : 0;
  const avgProtein = loggedDays > 0 ? Math.round(totalProtein  / loggedDays) : 0;
  const compliancePct = maxChecks > 0 ? Math.round((totalChecks / maxChecks) * 100) : 0;
  const calAdherence  = macros.calories > 0 ? Math.round((avgCals / macros.calories) * 100) : 0;
  const protAdherence = macros.protein  > 0 ? Math.round((avgProtein / macros.protein) * 100) : 0;

  return {
    compliancePct, avgCals, avgProtein, calAdherence, protAdherence,
    loggedDays, calsByDay, checksByDay,
  };
}

// ── Compute week number safely ────────────────────────────────────────────────
// Returns 1 when joinDate is missing or in the future.
function computeWeekNumber(joinDate?: string): number {
  if (!joinDate) return 1;
  const joined = new Date(joinDate).getTime();
  if (isNaN(joined)) return 1;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((Date.now() - joined) / msPerWeek));
}

const SYSTEM_PROMPT = `You are a precision physique coach and data analyst. You receive 7 days of client 
tracking data and produce a sharp, honest, motivating weekly analysis report.

TONE: Direct, coaching voice. Celebrate wins specifically. Call out gaps directly but constructively. 
No fluff. Every insight must be actionable. Sound like an experienced coach who knows their client, not a generic chatbot.

CALORIE ADJUSTMENT RULES:
- Weight down > 1.5 lbs/week AND under-eating by >10%: INCREASE calories 100–150 kcal
- Weight down 0.5–1.5 lbs/week: HOLD — this is the ideal fat-loss pace
- Weight unchanged AND goal=cut: DECREASE calories 100–150 kcal
- Weight up AND goal=cut: DECREASE calories 150–200 kcal
- Weight up AND goal=bulk: HOLD or slight increase if under target
- Poor protein compliance (<80%): Flag protein as #1 priority before adjusting calories

OUTPUT: Respond with ONLY valid JSON — no markdown, no commentary.

JSON SCHEMA:
{
  "weeklyScore": number,          // 0-100 composite score
  "grade": "string",              // "A+", "A", "B+", "B", "C+", "C", "D", "F"
  "compliance": {
    "pct": number,
    "label": "string",            // "Excellent" / "Good" / "Fair" / "Poor"
    "delta": "string"             // "+3% vs last week" — use "N/A" if no prior data
  },
  "macroAdherence": {
    "caloriesPct": number,
    "proteinPct":  number,
    "status": "string"            // "On target" | "Under-eating" | "Over-eating" | "Low protein"
  },
  "weightTrend": {
    "direction": "string",        // "down" | "up" | "stable"
    "lbsPerWeek": number | null,
    "onTrack": boolean,
    "note": "string"              // brief interpretation
  },
  "calorieAdjustment": {
    "action": "string",           // "HOLD" | "INCREASE" | "DECREASE" | "N/A"
    "amount": number,             // kcal delta, 0 if HOLD
    "newTarget": number,          // current calories +/- amount
    "reason": "string"            // 1 sentence reasoning
  },
  "insights": [
    { "type": "win"|"gap"|"tip", "text": "string" }
  ],
  "coachMessage": "string",       // 2–4 sentence personalised message from coach to client
  "clientSummary": "string",      // 1 paragraph plain-English summary for client dashboard
  "priorityNextWeek": "string"    // single most important focus for the coming week
}`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return jsonError("ANTHROPIC_API_KEY not configured", 500);

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

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonError("Invalid JSON", 400); }

  const { user: profile, logs, checkIn, macros } = body as {
    user: UserProfile;
    logs: DailyLog[];
    checkIn?: CheckIn;
    macros: MacroTargets;
  };

  if (!profile || !logs || !macros) return jsonError("user, logs, and macros are required", 400);
  if (!Array.isArray(logs) || logs.length < 1) return jsonError("logs must be a non-empty array", 400);

  // ── Compute summaries ──────────────────────────────────────────────────────
  const summary = summariseLogs(logs, macros);
  const weightDelta = checkIn?.weight ? +(checkIn.weight - profile.weight).toFixed(1) : null;

  // FIX: Use safe weekNumber computation — previously returned 0 when joinDate was missing
  const weekNumber = computeWeekNumber(profile.joinDate);

  const userPrompt = `Analyse this client's week and return the JSON report.

CLIENT: ${profile.firstName}, ${profile.age}yo ${profile.sex}, ${profile.weight}lbs → goal ${profile.goalWeight}lbs (${profile.goal?.replace(/_/g, " ")})
TIER: ${profile.tier} | WEEK: ${weekNumber} in program

MACRO TARGETS: ${macros.calories} kcal / ${macros.protein}g protein / ${macros.carb}g carbs / ${macros.fat}g fat

7-DAY SUMMARY:
- Checklist compliance: ${summary.compliancePct}% (${summary.checksByDay.map((c, i) => `Day${i + 1}:${c}/8`).join(", ")})
- Days with food logged: ${summary.loggedDays}/7
- Avg daily calories: ${summary.avgCals} kcal (${summary.calAdherence}% of target)
- Avg daily protein: ${summary.avgProtein}g (${summary.protAdherence}% of target)
- Calories by day: [${summary.calsByDay.join(", ")}]

${checkIn ? `WEEKLY CHECK-IN:
- Weight this week: ${checkIn.weight ?? "not logged"} lbs ${weightDelta !== null ? `(${weightDelta > 0 ? "+" : ""}${weightDelta} lbs from baseline)` : ""}
- Energy: ${checkIn.energy ?? "?"}/10 | Sleep: ${checkIn.sleep ?? "?"}/10 | Stress: ${checkIn.stress ?? "?"}/10 | Training perf: ${checkIn.perf ?? "?"}/10
- Win: "${checkIn.win ?? "—"}"
- Challenge: "${checkIn.challenge ?? "—"}"
- Question for coach: "${checkIn.coachQ ?? "—"}"` : "No check-in submitted this week."}

Return the JSON analysis now.`;

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
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) return jsonError("AI analysis failed", 502);
    const aiData = await res.json();
    const rawText = aiData.content?.[0]?.text ?? "";

    let report: Record<string, unknown>;
    try {
      const cleaned = rawText.replace(/```json\n?|```\n?/g, "").trim();
      report = JSON.parse(cleaned);
    } catch {
      console.error("Weekly analyst parse failed:", rawText.slice(0, 400));
      return jsonError("Failed to parse AI report", 422);
    }

    // Attach computed metadata
    report.weekNumber    = weekNumber;
    report.generatedAt   = new Date().toISOString();
    report.compliancePct = summary.compliancePct;
    report.avgCals       = summary.avgCals;
    report.avgProtein    = summary.avgProtein;

    // Usage counter
    if (profile.email) {
      try {
        const today = new Date().toISOString().split("T")[0];
        await supabase.rpc("increment_ai_usage", { p_email: profile.email, p_date: today });
      } catch { /* non-fatal */ }
    }

    return new Response(JSON.stringify({ report }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("weekly-analyst error:", err);
    return jsonError("Internal server error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
