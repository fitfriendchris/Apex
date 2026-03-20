import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";
const GEMINI_MODEL = "models/gemini-2.5-flash";

// ── STEP 1: Gemini identifies foods + portions ─────────────────────────────
async function identifyFoods(meal: string, image: any, geminiKey: string) {
  const prompt = image
    ? `List every food in this photo with portions. Return ONLY a JSON array:
[{"food":"chicken breast","portion":"6 oz","grams":170}]
Use specific names: "cooked oatmeal" not "oats", "scrambled eggs" not "eggs".`
    : `Break this meal into foods with portions: "${meal}"
Return ONLY a JSON array, no markdown:
[{"food":"scrambled eggs","portion":"2 large","grams":100},{"food":"cooked oatmeal","portion":"1 cup","grams":234}]
Use specific USDA-friendly names.`;

  const parts = image
    ? [{ inline_data: { mime_type: image.mediaType || "image/jpeg", data: image.base64 } }, { text: prompt }]
    : [{ text: prompt }];

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
    }
  );

  const d = await r.json();
  if (d.error) throw new Error("Gemini error: " + d.error.message);
  const text = (d.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Gemini returned no JSON array. Got: " + text.substring(0, 150));
  return JSON.parse(text.substring(start, end + 1));
}

// ── STEP 2: USDA lookup with smart result selection ────────────────────────
async function usdaLookup(foodName: string, portionStr: string, grams: number, apiKey: string) {
  const params = new URLSearchParams({ query: foodName, pageSize: "10", api_key: apiKey });
  params.append("dataType", "Foundation");
  params.append("dataType", "SR Legacy");
  const url = `${USDA_BASE}/foods/search?${params.toString()}`;

  const res = await fetch(url);
  const raw = await res.text();
  if (!res.ok || raw.trimStart().startsWith("<")) {
    throw new Error("USDA API error " + res.status);
  }
  const data = JSON.parse(raw);
  const foods = data.foods || [];
  if (!foods.length) return null;

  // Score each result — penalise mismatches like "oil" when searching "oats"
  const queryWords = foodName.toLowerCase().split(/\s+/);
  const scored = foods.map((f: any) => {
    const desc = (f.description || "").toLowerCase();
    // Count how many query words appear in the description
    const matches = queryWords.filter((w: string) => desc.includes(w)).length;
    // Penalise results where key words are completely absent
    const penalty = queryWords.some((w: string) => desc.includes(w)) ? 0 : -10;
    // Prefer Foundation > SR Legacy
    const typePriority = f.dataType === "Foundation" ? 2 : f.dataType === "SR Legacy" ? 1 : 0;
    return { food: f, score: matches + typePriority + penalty };
  });

  scored.sort((a: any, b: any) => b.score - a.score);
  const best = scored[0].food;

  // Extract per-100g nutrients
  const get = (id: number) => {
    const n = (best.foodNutrients || []).find(
      (n: any) => n.nutrientId === id || n.nutrientNumber === String(id)
    );
    return n?.value || n?.amount || 0;
  };

  const per100 = {
    calories: get(1008) || get(2047),
    protein: get(1003),
    carbs: get(1005),
    fats: get(1004),
    fiber: get(1079),
    sugar: get(2000),
  };

  // Use provided grams, fall back to portion parsing
  const portionGrams = grams || parsePortion(portionStr, foodName, best);
  const ratio = portionGrams / 100;

  return {
    name: best.description,
    originalName: foodName,
    portion: portionStr,
    grams: Math.round(portionGrams),
    calories: Math.round(per100.calories * ratio),
    protein: Math.round(per100.protein * ratio * 10) / 10,
    carbs: Math.round(per100.carbs * ratio * 10) / 10,
    fats: Math.round(per100.fats * ratio * 10) / 10,
    fiber: Math.round(per100.fiber * ratio * 10) / 10,
    sugar: Math.round(per100.sugar * ratio * 10) / 10,
    dataType: best.dataType,
  };
}

function parsePortion(portion: string, foodName: string, usdaItem: any): number {
  const p = portion.toLowerCase();
  const food = foodName.toLowerCase();
  const num = parseFloat(p.match(/[\d.]+/)?.[0] || "1");

  if (p.match(/\d+\s*g\b/))     return num;
  if (p.includes("oz"))          return num * 28.35;
  if (p.includes("lb"))          return num * 453.6;
  if (p.includes("cup"))         return num * 240;
  if (p.includes("tbsp"))        return num * 15;
  if (p.includes("tsp"))         return num * 5;
  if (p.includes("scoop"))       return num * 35;
  if (p.includes("slice"))       return food.includes("bread") ? num * 28 : food.includes("pizza") ? num * 107 : num * 30;
  if (p.includes("large") && food.includes("egg")) return num * 56;
  if (p.includes("medium") && food.includes("egg")) return num * 44;
  if (p.includes("small") && food.includes("egg")) return num * 38;

  // Use USDA serving size if available
  if (usdaItem?.servingSize) return num * usdaItem.servingSize;

  // Common defaults
  if (food.includes("egg"))     return num * 50;
  if (food.includes("chicken") || food.includes("beef") || food.includes("fish") || food.includes("salmon")) return num * 85;
  if (food.includes("rice") || food.includes("pasta") || food.includes("oat")) return num * 180;
  if (food.includes("banana"))  return num * 118;
  if (food.includes("apple"))   return num * 182;
  if (food.includes("milk"))    return num * 240;
  return num * 100;
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const usdaKey   = Deno.env.get("USDA_API_KEY")  || "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";

    if (!["text", "scan"].includes(body.type)) {
      return new Response(JSON.stringify({ error: "type must be scan or text" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (!geminiKey) return new Response(JSON.stringify({ error: "Gemini key not configured" }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!usdaKey)   return new Response(JSON.stringify({ error: "USDA key not configured" }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });

    const meal  = body.meal  || "";
    const image = body.type === "scan" ? body.image : null;
    if (body.type === "scan" && !image?.base64) {
      return new Response(JSON.stringify({ error: "Missing image data" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Step 1: Identify foods
    console.log(`[${body.type}] Identifying foods...`);
    const identified = await identifyFoods(meal, image, geminiKey);
    console.log(`[${body.type}] Found:`, identified.map((i: any) => i.food).join(", "));

    // Step 2: USDA lookup in parallel
    console.log(`[${body.type}] Looking up in USDA...`);
    const lookups = await Promise.all(
      identified.map((item: any) => usdaLookup(item.food, item.portion, item.grams || 0, usdaKey))
    );
    const valid = lookups.filter(Boolean) as any[];

    if (!valid.length) {
      return new Response(
        JSON.stringify({ error: "Could not find foods in USDA database. Try being more specific." }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Sum totals
    const total = valid.reduce(
      (acc, item) => ({
        calories: acc.calories + item.calories,
        protein:  Math.round((acc.protein + item.protein) * 10) / 10,
        carbs:    Math.round((acc.carbs   + item.carbs)   * 10) / 10,
        fats:     Math.round((acc.fats    + item.fats)    * 10) / 10,
        fiber:    Math.round((acc.fiber   + item.fiber)   * 10) / 10,
        sugar:    Math.round((acc.sugar   + item.sugar)   * 10) / 10,
      }),
      { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0, sugar: 0 }
    );

    const food = {
      name: meal.length > 60 ? meal.substring(0, 60) : (meal || valid.map((v) => v.originalName).join(", ")),
      portion: valid.map((v) => `${v.portion} ${v.originalName}`).join(" + "),
      ...total,
      rating: 4,
      source: "USDA FoodData Central",
      items: valid.length > 1 ? valid.map((v) => ({
        name: v.name,
        portion: `${v.grams}g`,
        calories: v.calories,
        protein: v.protein,
        carbs: v.carbs,
        fats: v.fats,
      })) : undefined,
      insights: [
        `USDA verified (${[...new Set(valid.map((v) => v.dataType))].join(", ")})`,
        `P: ${total.protein}g · C: ${total.carbs}g · F: ${total.fats}g`,
      ],
    };

    console.log(`[${body.type}] Result: ${food.name} — ${food.calories} kcal`);
    return new Response(JSON.stringify({ ok: true, food }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    const m = err instanceof Error ? err.message : "Unknown error";
    console.error("[analyze-food]", m);
    return new Response(JSON.stringify({ error: m }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
