const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const ALLOWED_ORIGINS = [
  "https://apexcoaching.app",
  "https://apex-356.pages.dev",
  "https://fitfriendchris.github.io",
  "http://localhost:8888",
  "http://localhost:3000",
];

function getCors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

async function callClaude(systemPrompt: string, userMessage: string, maxTokens = 600): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error("Anthropic error: " + res.status);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function generateWeeklyReport(payload: Record<string, unknown>): Promise<string> {
  const { clientName, weekData, avgCal, avgProtein, trainDays, goalCal, goalProtein } = payload as {
    clientName: string;
    weekData: unknown[];
    avgCal: number;
    avgProtein: number;
    trainDays: number;
    goalCal: number;
    goalProtein: number;
  };

  const system = `You are an elite fitness coach writing a weekly performance review for a client.
Be direct, expert, and genuinely encouraging — like a coach who cares but doesn't sugarcoat.
Keep the total response under 180 words. Write 3 paragraphs only.`;

  const user = `Client: ${clientName}
Week summary: ${trainDays} training days logged
Avg daily calories: ${avgCal} kcal (goal: ${goalCal} kcal)
Avg daily protein: ${avgProtein}g (goal: ${goalProtein}g)

Write a 3-paragraph report:
1. What's working well (be specific to the data)
2. The #1 thing to focus on this week (direct, actionable)
3. One motivational closing line

No headers, no bullet points. Just 3 short paragraphs.`;

  return await callClaude(system, user, 400);
}

async function generateMealPlan(payload: Record<string, unknown>): Promise<Record<string, string>> {
  const { calories, protein, carbs, fats, goal, name } = payload as {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    goal: string;
    name?: string;
  };

  const system = `You are a precision nutrition coach. Return ONLY valid JSON — no markdown, no explanation.`;

  const user = `Create a 7-day meal plan for a client with these daily targets:
- Calories: ${calories} kcal
- Protein: ${protein}g
- Carbs: ${carbs}g
- Fats: ${fats}g
- Goal: ${goal}
${name ? `- Client: ${name}` : ""}

Return a JSON object with exactly 28 keys in this format:
{
  "Monday_Breakfast": "meal description",
  "Monday_Lunch": "meal description",
  "Monday_Dinner": "meal description",
  "Monday_Snack": "meal description",
  "Tuesday_Breakfast": "...",
  ... (all 7 days × 4 meals)
}

Each meal: specific foods with portions (e.g. "6oz grilled chicken, 1 cup brown rice, 2 cups broccoli").
Max 15 words per meal. Start your response with { and end with }.`;

  const text = await callClaude(system, user, 1500);
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(clean);
}

Deno.serve(async (req) => {
  const cors = getCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const { type, payload } = await req.json();

    if (type === "weekly-report") {
      const report = await generateWeeklyReport(payload ?? {});
      return new Response(JSON.stringify({ report }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (type === "meal-plan") {
      const plan = await generateMealPlan(payload ?? {});
      return new Response(JSON.stringify({ plan }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown type: " + type }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
