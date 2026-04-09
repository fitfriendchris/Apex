// supabase/functions/coach-copilot/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// AGENT 4 — CoachCopilot AI
// Coach-only assistant. Four actions:
//
//  1. draft-response  — Draft a personalised reply to a client's check-in or message
//  2. risk-scan       — Scan all client data and flag at-risk users with severity + recommended action
//  3. macro-adjust    — Calculate a smart calorie/macro adjustment based on trends
//  4. client-brief    — Generate a one-page coaching brief for a client
//
// Deploy:
//   supabase functions deploy coach-copilot
//
// Secrets:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set COACH_SECRET=your_coach_password
//   supabase secrets set ALLOWED_ORIGIN=https://apexcoaching.app
//
// Request body:
//   { action, clientData, coachStyle?, allClients? }
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://apexcoaching.app";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-coach-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Action-specific system prompts ────────────────────────────────────────────

const PROMPTS: Record<string, string> = {

  "draft-response": `You are an elite physique coach writing a personalised response to a client's weekly check-in. 
Your voice: Direct, warm, knowledgeable, motivating without being generic. You know this client's data.
RULES:
- Reference specific numbers (their actual weight, compliance %, protein intake)
- Address their win with genuine praise
- Address their challenge with a specific fix, not vague encouragement
- Answer their question for coach clearly and directly
- End with a clear #1 priority for next week
- Length: 100–200 words. No bullet points — it should read like a real coach message.
Return ONLY a JSON object: { "message": "string", "subject": "string" }`,

  "risk-scan": `You are a coaching analytics AI scanning client data to identify who needs urgent attention.
RISK LEVELS:
- critical: 2+ danger signals (compliance < 30%, significant weight gain on cut, no logs in 5+ days, concerning mental health signals)
- high:     1 danger + 1 warning (compliance 30-50%, missed check-in, calories chronically low)
- medium:   trending the wrong way but still engaged
- low:      minor slip, on track overall
Return ONLY a JSON array: [{ "email": string, "name": string, "riskLevel": "critical"|"high"|"medium"|"low", "signals": string[], "recommendedAction": string, "urgency": "immediate"|"this_week"|"monitor" }]
Sort by risk level descending. Include ALL clients, even low-risk ones.`,

  "macro-adjust": `You are a precision nutrition coach computing a data-driven macro adjustment.
Use the Haakonssen et al. weight trend methodology: use 7-day average, not single weigh-in.
ADJUSTMENT THRESHOLDS (goal = cut):
- avg down > 1.5 lbs/week: ADD 100–150 kcal (too aggressive)
- avg down 0.5–1.0 lbs/week: HOLD (ideal pace)
- avg down < 0.5 lbs/week for 2+ weeks: REDUCE 100 kcal
- avg up: REDUCE 150–200 kcal
(goal = bulk): reverse logic — want 0.25–0.5 lbs/week gain
Always adjust protein last. Fix calories first, then redistribute macros.
Return ONLY JSON: { "action": "HOLD"|"INCREASE"|"DECREASE", "calsChange": number, "newCalories": number, "newProtein": number, "newCarb": number, "newFat": number, "reasoning": string, "confidence": "high"|"medium"|"low" }`,

  "client-brief": `You are a head coach writing a concise one-page brief about a client for another coach taking over.
Cover: background, current phase, what's working, what isn't, key coaching insights, watch-outs, next steps.
Tone: Professional handoff document — factual, specific, no fluff.
Return ONLY JSON: { "brief": string, "quickStats": { "weeklyScore": number, "trend": string, "primaryFocus": string }, "watchOuts": string[], "nextSteps": string[] }`,
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  // ── Coach-only endpoint ───────────────────────────────────────────────────────
  const coachToken = req.headers.get("X-Coach-Token") ?? "";
  const validSecret = Deno.env.get("COACH_SECRET") ?? "";
  if (!coachToken || coachToken !== validSecret) {
    return jsonError("Coach authentication required", 401);
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return jsonError("ANTHROPIC_API_KEY not configured", 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonError("Invalid JSON", 400); }

  const { action, clientData, coachStyle, allClients } = body as {
    action: "draft-response" | "risk-scan" | "macro-adjust" | "client-brief";
    clientData?: Record<string, unknown>;
    coachStyle?: string;
    allClients?: Record<string, unknown>[];
  };

  if (!action || !PROMPTS[action]) {
    return jsonError(`action must be one of: ${Object.keys(PROMPTS).join(", ")}`, 400);
  }

  // ── Build action-specific user prompt ─────────────────────────────────────────
  let userPrompt = "";

  if (action === "draft-response") {
    if (!clientData) return jsonError("clientData required for draft-response", 400);
    const c = clientData;
    userPrompt = `Write a coaching response for this client.

CLIENT: ${c.firstName} ${c.lastName} | ${c.age}yo ${c.sex} | ${c.weight}lbs → ${c.goalWeight}lbs | Tier: ${c.tier}
GOAL: ${String(c.goal ?? "").replace(/_/g, " ")} | Week ${c.weekNumber ?? "?"} in program

THIS WEEK'S DATA:
- Compliance: ${c.compliancePct ?? "?"}% | Avg calories: ${c.avgCals ?? "?"}/${c.targetCals ?? "?"} kcal | Avg protein: ${c.avgProtein ?? "?"}/${c.targetProtein ?? "?"}g
- Weight this week: ${c.checkInWeight ?? "not logged"} lbs
- Energy: ${c.energy ?? "?"}/10 | Sleep: ${c.sleep ?? "?"}/10 | Training perf: ${c.perf ?? "?"}/10

CLIENT'S CHECK-IN:
Win: "${c.win ?? "—"}"
Challenge: "${c.challenge ?? "—"}"
Question: "${c.coachQ ?? "—"}"
${coachStyle ? `\nCoach style preference: ${coachStyle}` : ""}

Return the JSON coaching message now.`;

  } else if (action === "risk-scan") {
    if (!allClients?.length) return jsonError("allClients array required for risk-scan", 400);
    const summaries = allClients.map(c => ({
      email: c.email,
      name: `${c.firstName} ${c.lastName}`,
      tier: c.tier,
      compliancePct: c.compliancePct,
      avgCals: c.avgCals,
      targetCals: c.targetCals,
      lastLogDate: c.lastLogDate,
      weightTrend: c.weightTrend,
      goal: c.goal,
      checkInSubmitted: c.checkInSubmitted,
      daysLogged: c.daysLogged,
    }));
    userPrompt = `Scan these ${summaries.length} clients and return the risk assessment JSON array.\n\nClient data:\n${JSON.stringify(summaries, null, 2)}`;

  } else if (action === "macro-adjust") {
    if (!clientData) return jsonError("clientData required for macro-adjust", 400);
    const c = clientData;
    userPrompt = `Calculate a macro adjustment for this client.

CLIENT: ${c.firstName} | Goal: ${String(c.goal ?? "").replace(/_/g, " ")} | ${c.weight}lbs → ${c.goalWeight}lbs
CURRENT TARGETS: ${c.calories} kcal / ${c.protein}g protein / ${c.carb}g carbs / ${c.fat}g fat

7-DAY WEIGHT LOG: [${Array.isArray(c.weights) ? c.weights.join(", ") : "N/A"}] lbs
AVG DAILY INTAKE: ${c.avgCals ?? "?"} kcal | ${c.avgProtein ?? "?"}g protein
COMPLIANCE: ${c.compliancePct ?? "?"}%
WEEKS AT CURRENT CALORIES: ${c.weeksAtCurrentCals ?? 1}

Return the macro adjustment JSON now.`;

  } else if (action === "client-brief") {
    if (!clientData) return jsonError("clientData required for client-brief", 400);
    userPrompt = `Write a client handoff brief for:\n\n${JSON.stringify(clientData, null, 2)}\n\nReturn the JSON brief now.`;
  }

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
        max_tokens: action === "risk-scan" ? 4096 : 2048,
        system: PROMPTS[action],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) return jsonError("AI copilot call failed", 502);
    const aiData = await res.json();
    const rawText = aiData.content?.[0]?.text ?? "";

    let result: unknown;
    try {
      const cleaned = rawText.replace(/```json\n?|```\n?/g, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      console.error("CoachCopilot parse failed:", rawText.slice(0, 400));
      return jsonError("Failed to parse AI output", 422);
    }

    return new Response(JSON.stringify({ action, result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("coach-copilot error:", err);
    return jsonError("Internal server error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
