import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

// ── STEP 1: AI identifies foods + portions from text or image ──────────────
async function aiIdentifyFoods(meal: string, image: any, geminiKey: string): Promise<any[]> {
  const prompt = image
    ? `Look at this food photo. List every food item you can see with estimated portions.
Return ONLY a JSON array, no markdown:
[{"food":"chicken breast","portion":"6 oz"},{"food":"white rice","portion":"1 cup cooked"}]
Be specific with portions. Use oz, grams, cups, or count (e.g. "2 large eggs").`
    : `Break this meal description into individual food items with specific portions:
"${meal}"
Return ONLY a JSON array, no markdown:
[{"food":"chicken breast","portion":"6 oz"},{"food":"white rice","portion":"1 cup cooked"}]
If portions aren't mentioned, estimate realistic ones. Be specific.`;

  const parts = image
    ? [{ inline_data: { mime_type: image.mediaType || "image/jpeg", data: image.base64 } }, { text: prompt }]
    : [{ text: prompt }];

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0, maxOutputTokens: 400 },
      }),
    }
  );
  const d = await r.json();
  if (d.error) throw new Error("Gemini error: " + d.error.message);
  const text = (d.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(clean);
}

// ── STEP 2: USDA lookup for each identified item ───────────────────────────
async function usdaLookup(foodName: string, portionStr: string, apiKey: string) {
  const url = `${USDA_BASE}/foods/search?query=${encodeURIComponent(foodName)}&dataType=SR%20Legacy,Foundation,Survey%20(FNDDS)&pageSize=5&api_key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  const foods = data.foods || [];
  if (!foods.length) return null;

  // Prefer Foundation > SR Legacy > Survey
  const priority = ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"];
  const best = foods.sort((a: any, b: any) =>
    priority.indexOf(a.dataType) - priority.indexOf(b.dataType)
  )[0];

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

  // Parse portion string to grams
  const grams = portionToGrams(portionStr, foodName, best);
  const ratio = grams / 100;

  return {
    name: best.description,
    originalName: foodName,
    portion: portionStr,
    grams: Math.round(grams),
    calories: Math.round(per100.calories * ratio),
    protein: Math.round(per100.protein * ratio * 10) / 10,
    carbs: Math.round(per100.carbs * ratio * 10) / 10,
    fats: Math.round(per100.fats * ratio * 10) / 10,
    fiber: Math.round(per100.fiber * ratio * 10) / 10,
    sugar: Math.round(per100.sugar * ratio * 10) / 10,
    dataType: best.dataType,
    fdcId: best.fdcId,
  };
}

function portionToGrams(portion: string, foodName: string, usdaItem: any): number {
  const p = portion.toLowerCase().trim();
  const food = foodName.toLowerCase();

  // Extract leading number (handles "1.5", "1/2", "2")
  const numMatch = p.match(/^(\d+\.?\d*|\d+\/\d+)/);
  const qty = numMatch
    ? numMatch[1].includes("/")
      ? eval(numMatch[1])  // safe: only fractions like 1/2
      : parseFloat(numMatch[1])
    : 1;

  if (p.includes("gram") || p.match(/\dg\b/)) return qty;
  if (p.includes("oz"))   return qty * 28.35;
  if (p.includes("lb"))   return qty * 453.6;
  if (p.includes("cup"))  return qty * 240;
  if (p.includes("tbsp")) return qty * 15;
  if (p.includes("tsp"))  return qty * 5;
  if (p.includes("ml"))   return qty; // approximate 1ml ≈ 1g for most foods
  if (p.includes("liter") || p.includes("litre")) return qty * 1000;
  if (p.includes("slice") || p.includes("piece")) {
    if (food.includes("bread"))  return qty * 28;
    if (food.includes("pizza"))  return qty * 107;
    if (food.includes("cheese")) return qty * 28;
    return qty * 30;
  }
  if (p.includes("scoop"))  return qty * 35;
  if (p.includes("medium") || p.includes("large") || p.includes("small")) {
    if (food.includes("egg"))    return qty * (p.includes("large") ? 56 : p.includes("small") ? 38 : 44);
    if (food.includes("apple"))  return qty * (p.includes("large") ? 223 : 182);
    if (food.includes("banana")) return qty * (p.includes("large") ? 136 : 118);
    if (food.includes("potato")) return qty * (p.includes("large") ? 299 : 173);
    return qty * 100;
  }
  // Count-based — use USDA serving size if available
  if (usdaItem?.servingSize) return qty * usdaItem.servingSize;
  // Common defaults by food type
  if (food.includes("egg"))    return qty * 50;
  if (food.includes("chicken") || food.includes("beef") || food.includes("salmon") || food.includes("tuna")) return qty * 85;
  if (food.includes("rice") || food.includes("pasta") || food.includes("oat")) return qty * 195;
  if (food.includes("milk"))   return qty * 240;
  return qty * 100; // fallback
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const usdaKey   = Deno.env.get("USDA_API_KEY")   || "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY")  || "";

    const isText = body.type === "text";
    const isScan = body.type === "scan";

    if (!isText && !isScan) {
      return new Response(JSON.stringify({ error: "type must be scan or text" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "Gemini key not configured" }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (!usdaKey) {
      return new Response(JSON.stringify({ error: "USDA API key not configured" }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ── STEP 1: AI identifies what foods are present ──────────────────────
    const meal  = body.meal  || "";
    const image = isScan ? body.image : null;

    if (isScan && !image?.base64) {
      return new Response(JSON.stringify({ error: "Missing image data" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    console.log(`[${body.type}] Step 1: AI identifying foods...`);
    const identified = await aiIdentifyFoods(meal, image, geminiKey);
    console.log(`[${body.type}] Identified ${identified.length} items:`, identified.map((i: any) => i.food).join(", "));

    // ── STEP 2: USDA lookup for each item in parallel ─────────────────────
    console.log(`[${body.type}] Step 2: USDA lookup...`);
    const lookups = await Promise.all(
      identified.map((item: any) => usdaLookup(item.food, item.portion, usdaKey))
    );
    const valid = lookups.filter(Boolean) as any[];

    if (!valid.length) {
      return new Response(
        JSON.stringify({ error: "Could not find any of the identified foods in the USDA database. Try describing the food differently." }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ── STEP 3: Sum all items ─────────────────────────────────────────────
    const total = valid.reduce(
      (acc, item) => ({
        calories: acc.calories + item.calories,
        protein:  Math.round((acc.protein + item.protein)  * 10) / 10,
        carbs:    Math.round((acc.carbs   + item.carbs)    * 10) / 10,
        fats:     Math.round((acc.fats    + item.fats)     * 10) / 10,
        fiber:    Math.round((acc.fiber   + item.fiber)    * 10) / 10,
        sugar:    Math.round((acc.sugar   + item.sugar)    * 10) / 10,
      }),
      { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0, sugar: 0 }
    );

    const mealName = isScan
      ? valid.map((v) => v.originalName).join(", ")
      : (meal.length > 60 ? meal.substring(0, 60) : meal);

    const food = {
      name: mealName,
      portion: valid.map((v) => `${v.portion} ${v.originalName}`).join(" + "),
      ...total,
      rating: 4,
      source: "USDA FoodData Central",
      items: valid.length > 1
        ? valid.map((v) => ({ name: v.name, portion: v.portion, calories: v.calories, protein: v.protein, carbs: v.carbs, fats: v.fats }))
        : undefined,
      insights: [
        `Verified via USDA FoodData Central (${[...new Set(valid.map((v) => v.dataType))].join(", ")})`,
        `P: ${total.protein}g (${Math.round(total.protein * 4)} kcal) · C: ${total.carbs}g (${Math.round(total.carbs * 4)} kcal) · F: ${total.fats}g (${Math.round(total.fats * 9)} kcal)`,
      ],
    };

    console.log(`[${body.type}] Done: ${food.name} — ${food.calories} kcal`);
    return new Response(JSON.stringify({ ok: true, food }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    const m = err instanceof Error ? err.message : "Unknown error";
    console.error("[analyze-food error]", m);
    return new Response(JSON.stringify({ error: m }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
