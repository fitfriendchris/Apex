// supabase/functions/analyze-food/index.ts
// Handles both text AI log and photo scan
// Uses Anthropic Claude for text, Gemini for photo scan (with robust JSON parsing)

const ANTHROPIC_KEY  = Deno.env.get("ANTHROPIC_API_KEY")!;
const GEMINI_KEY     = Deno.env.get("GEMINI_API_KEY")!;
const GROQ_KEY       = Deno.env.get("GROQ_API_KEY")!;
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://apexcoaching.app";

const cors = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Robust JSON extractor ────────────────────────────────────────────────────
// Handles: raw JSON, ```json ... ```, partial arrays, trailing text
function extractJSON(raw: string): unknown {
  // 1. Strip markdown fences
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // 2. Try direct parse first
  try { return JSON.parse(s); } catch (_) { /* continue */ }

  // 3. Find first [ or { and last ] or }
  const arrStart = s.indexOf("[");
  const objStart = s.indexOf("{");
  
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    // Try to extract array
    const arrEnd = s.lastIndexOf("]");
    if (arrEnd > arrStart) {
      try { return JSON.parse(s.slice(arrStart, arrEnd + 1)); } catch (_) { /* continue */ }
    }
    // Array might be truncated — try to close it
    try { return JSON.parse(s.slice(arrStart) + "]"); } catch (_) { /* continue */ }
  }

  if (objStart !== -1) {
    const objEnd = s.lastIndexOf("}");
    if (objEnd > objStart) {
      try { return JSON.parse(s.slice(objStart, objEnd + 1)); } catch (_) { /* continue */ }
    }
  }

  throw new Error(`Could not parse JSON from: ${raw.slice(0, 200)}`);
}

// ─── Build food object from AI response ──────────────────────────────────────
function buildFoodObject(items: unknown[], name: string): Record<string, unknown> {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Empty food array");

  // Sum across all items
  const totals = {
    calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0,
    vitaminA: 0, vitaminC: 0, vitaminD: 0, vitaminE: 0,
    calcium: 0, iron: 0, magnesium: 0, zinc: 0, potassium: 0,
    sodium: 0, omega3: 0, folate: 0, b12: 0, selenium: 0,
  };

  for (const item of items as Record<string, number>[]) {
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      totals[key] += parseFloat(String(item[key] || 0)) || 0;
    }
  }

  // Round everything
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
    totals[k] = Math.round(totals[k] * 10) / 10;
  }

  const insights = [
    `${totals.protein}g protein · ${totals.carbs}g carbs · ${totals.fats}g fat`,
    totals.fiber > 3 ? `Good fiber source (${totals.fiber}g)` : "Low fiber — consider adding veggies",
    totals.sodium > 800 ? `High sodium (${totals.sodium}mg)` : `Sodium: ${totals.sodium}mg`,
  ];

  return {
    name,
    portion: items.length > 1 ? `${items.length} items` : "1 serving",
    category: "meal",
    ...totals,
    insights,
    items: items.map((i: Record<string, unknown>) => ({
      food: i.food || i.name || "Unknown",
      grams: i.grams || i.weight_g || 100,
      calories: Math.round(parseFloat(String(i.calories || 0))),
      protein: Math.round(parseFloat(String(i.protein || 0)) * 10) / 10,
      carbs: Math.round(parseFloat(String(i.carbs || 0)) * 10) / 10,
      fats: Math.round(parseFloat(String(i.fats || 0)) * 10) / 10,
    })),
  };
}

// ─── TEXT analysis via Anthropic ─────────────────────────────────────────────
async function analyzeText(meal: string, userContext: Record<string, unknown>): Promise<Record<string, unknown>> {
  const prompt = `You are a precise nutrition analyzer. The user ate: "${meal}"

Return ONLY a JSON array of food items. No explanation, no markdown, no preamble.
Each item must have ALL these fields (use 0 if unknown):
food, grams, calories, protein, carbs, fats, fiber, vitaminA, vitaminC, vitaminD, vitaminE, calcium, iron, magnesium, zinc, potassium, sodium, omega3, folate, b12, selenium

User context: weight=${userContext.weight}lbs, goal=${userContext.goal}, daily target=${userContext.calories}kcal

Example format:
[{"food":"Chicken breast","grams":150,"calories":247,"protein":46,"carbs":0,"fats":5,"fiber":0,"vitaminA":0,"vitaminC":0,"vitaminD":0,"vitaminE":0,"calcium":14,"iron":1.2,"magnesium":32,"zinc":1.8,"potassium":420,"sodium":74,"omega3":0.1,"folate":8,"b12":0.3,"selenium":27}]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const items = extractJSON(text) as unknown[];
  return buildFoodObject(Array.isArray(items) ? items : [items], meal);
}

// ─── PHOTO analysis via Gemini ────────────────────────────────────────────────
async function analyzePhoto(base64: string, mediaType: string): Promise<Record<string, unknown>> {
  const prompt = `Analyze this food photo. Identify every food item visible.

Return ONLY a valid JSON array. No markdown fences, no explanation, just the raw JSON array.
Each object must have: food, grams, calories, protein, carbs, fats, fiber, vitaminA, vitaminC, vitaminD, vitaminE, calcium, iron, magnesium, zinc, potassium, sodium, omega3, folate, b12, selenium

Start your response with [ and end with ]. Nothing before or after.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mediaType, data: base64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000,
        },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  let items: unknown[];
  try {
    items = extractJSON(text) as unknown[];
    if (!Array.isArray(items)) items = [items];
  } catch (e) {
    // Fallback: try Anthropic vision if Gemini JSON fails
    console.warn("Gemini parse failed, falling back to Anthropic:", e);
    return await analyzePhotoFallback(base64, mediaType);
  }

  return buildFoodObject(items, "Scanned meal");
}

// ─── PHOTO fallback via Anthropic vision ─────────────────────────────────────
async function analyzePhotoFallback(base64: string, mediaType: string): Promise<Record<string, unknown>> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: `Analyze this food photo. Return ONLY a JSON array of food items with fields: food, grams, calories, protein, carbs, fats, fiber, vitaminA, vitaminC, vitaminD, vitaminE, calcium, iron, magnesium, zinc, potassium, sodium, omega3, folate, b12, selenium. Start response with [ and end with ].`,
          },
        ],
      }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic vision fallback error: ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const items = extractJSON(text) as unknown[];
  return buildFoodObject(Array.isArray(items) ? items : [items], "Scanned meal");
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json();
    const { type, meal, image, userContext } = body;

    let food: Record<string, unknown>;

    if (type === "scan" && image?.base64) {
      food = await analyzePhoto(image.base64, image.mediaType || "image/jpeg");
    } else if (type === "text" && meal) {
      food = await analyzeText(meal, userContext || {});
    } else {
      return new Response(JSON.stringify({ error: "Invalid request: need type=text+meal or type=scan+image" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ food }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("analyze-food error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
