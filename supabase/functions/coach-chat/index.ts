import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { userEmail, message, history, userContext } = await req.json();
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("Anthropic key not configured");

    // Build system prompt with full client context
    const system = `You are an elite physique coaching AI assistant for APEX Coaching. You have access to this client's data and speak directly to them.

CLIENT PROFILE:
- Name: ${userContext.name}
- Goal: ${userContext.goal} (${userContext.phase})
- Current weight: ${userContext.weight}lbs → Goal: ${userContext.goalWeight}lbs (${userContext.weightToGoal}lbs to go)
- Daily targets: ${userContext.calories} cal | ${userContext.protein}g protein | ${userContext.carbs}g carbs | ${userContext.fat}g fat
- Program: ${userContext.program}
- Today's workout: ${userContext.todayWorkout}

THIS WEEK'S DATA:
- Compliance: ${userContext.weekCompliance}% (checklist completion)
- Avg calories logged: ${userContext.avgCals} kcal/day
- Protein avg: ${userContext.avgProtein}g/day
- Workout sessions: ${userContext.workoutSessions} this week
- Last check-in: ${userContext.lastCheckIn || 'none submitted'}

COACHING STYLE:
- Be direct, data-driven, and motivating
- Reference their specific numbers when relevant
- Give actionable advice, not generic tips
- Keep responses concise (2-4 sentences max unless explaining something complex)
- You are their coach — speak with authority and care
- If they ask about their specific macros, workouts, or progress, use their actual data above`;

    // Build message history for Claude
    const messages = [
      ...(history || []).slice(-10).map((m: any) => ({
        role: m.role === 'assistant' || m.role === 'coach' ? 'assistant' : 'user',
        content: m.content
      })),
      { role: "user", content: message }
    ];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system,
        messages,
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const reply = data.content?.[0]?.text || "I couldn't generate a response. Please try again.";

    return new Response(JSON.stringify({ ok: true, reply }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
