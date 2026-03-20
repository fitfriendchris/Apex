import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";
const GEMINI_MODEL = "models/gemini-2.5-flash";

// ── STEP 1: Gemini parses the meal description ─────────────────────────────
async function identifyFoods(meal: string, image: any, geminiKey: string) {
  const systemPrompt = image ? `You are a precise food identification system for a macro tracking app.
Analyze this food photo. List every distinct food item visible.
Return ONLY a valid JSON array. Each item needs exact USDA-searchable names.

CRITICAL RULES:
- Use the most specific USDA food name possible
- "beef patty" → "beef patty cooked broiled" 
- "burger patty" → "beef patty cooked broiled"
- "chicken" → "chicken breast cooked roasted"
- "rice" → "rice white cooked"
- "oats" → "oatmeal cooked"
- "potato" → "potato baked flesh"
- "egg" → "egg whole cooked scrambled"
- Estimate realistic grams based on visual size
- A typical burger patty = 85g (3oz), large = 113g (4oz)
- A large egg = 50g

Return format - ONLY this array, nothing else:
[{"food":"beef patty cooked broiled","portion":"1 patty (3 oz)","grams":85,"notes":"beef burger patty"}]`
  : `You are a precise food identification system for a macro tracking app.
Parse this meal description into individual food items: "${meal}"

CRITICAL RULES:
- Identify ALL foods mentioned, even repeated ones (if someone says "4 eggs plus 4 eggs" that is 8 eggs total)
- Use specific USDA-searchable names:
  * "beef patty/burger patty" → "beef patty cooked broiled"  
  * "chicken" → "chicken breast cooked roasted"
  * "rice" → "rice white cooked"
  * "oats/oatmeal" → "oatmeal cooked"
  * "potato/potatoes" → "potato boiled"
  * "egg/eggs" → "egg whole cooked scrambled"
  * "mini potatoes" → "potato boiled" (small, ~50g each)
  * "cupcake/muffin/cake" → "cake chocolate" or "cake yellow" (use generic)
  * "cookie" → "cookies chocolate chip"
  * "chips" → "potato chips"
  * "pizza" → "pizza cheese"
  * "burger" → "hamburger beef patty"
  * Any packaged snack → use the most generic USDA equivalent
- Estimate realistic portion grams:
  * Large egg = 50g, beef burger patty (regular) = 85g, mini potato = 50g
  * Chicken breast = 140g, banana = 118g, apple = 182g
  * Bite-size cupcake = 30g, regular cupcake = 75g, muffin = 113g

Return ONLY a valid JSON array, no markdown, no explanation:
[{"food":"egg whole cooked scrambled","portion":"8 large eggs","grams":400,"notes":"8 eggs total"},{"food":"beef patty cooked broiled","portion":"2 patties","grams":170,"notes":"2 burger patties"},{"food":"potato boiled","portion":"3 mini potatoes","grams":150,"notes":"3 small potatoes"}]`;

  const parts = image
    ? [{ inline_data: { mime_type: image.mediaType || "image/jpeg", data: image.base64 } }, { text: systemPrompt }]
    : [{ text: systemPrompt }];

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

  // Robust JSON array extraction
  // Strip markdown fences Gemini sometimes adds despite instructions
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini returned no valid JSON array. Response: " + text.substring(0, 200));
  }
  const jsonStr = clean.substring(start, end + 1);
  const items = JSON.parse(jsonStr);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Gemini returned empty food list");
  }
  return items;
}

// ── STEP 2: USDA lookup with strict relevance scoring ──────────────────────
async function usdaLookup(foodName: string, portionStr: string, grams: number, apiKey: string) {
  // Search with the exact food name
  const params = new URLSearchParams({ query: foodName, pageSize: "15", api_key: apiKey });
  params.append("dataType", "Foundation");
  params.append("dataType", "SR Legacy");
  const url = `${USDA_BASE}/foods/search?${params.toString()}`;

  const res = await fetch(url);
  const raw = await res.text();
  if (!res.ok || raw.trimStart().startsWith("<")) {
    throw new Error("USDA API error " + res.status);
  }
  const data = JSON.parse(raw);
  let foods = data.foods || [];

  // Fallback: if no results, try progressively simpler queries
  if (!foods.length) {
    const words = foodName.split(" ").filter((w: string) => w.length > 2);
    for (let i = words.length - 1; i >= 1; i--) {
      const simpler = words.slice(0, i).join(" ");
      console.log(`[USDA] No results for "${foodName}", trying "${simpler}"`);
      const p2 = new URLSearchParams({ query: simpler, pageSize: "10", api_key: apiKey });
      p2.append("dataType", "Foundation");
      p2.append("dataType", "SR Legacy");
      const r2 = await fetch(`${USDA_BASE}/foods/search?${p2.toString()}`);
      const d2 = JSON.parse(await r2.text());
      if (d2.foods?.length) { foods = d2.foods; break; }
    }
  }
  if (!foods.length) return null;

  // Smart scoring — prioritize exact matches, penalize obvious mismatches
  const queryTokens = foodName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  // Words that should NEVER appear in a match for certain searches
  const exclusions: Record<string, string[]> = {
    "oatmeal": ["oil", "bran", "flour", "granola"],
    "egg": ["substitute", "powder", "dried", "yolk only", "white only"],
    "beef patty": ["oil", "soup", "broth", "extract"],
    "potato": ["chips", "flour", "starch", "powder"],
    "chicken breast": ["soup", "broth", "nugget", "strip"],
    "rice white": ["flour", "bran", "wild", "brown"],
  };

  const scored = foods.map((f: any) => {
    const desc = (f.description || "").toLowerCase();
    
    // Count matching tokens
    const matchCount = queryTokens.filter((t: string) => desc.includes(t)).length;
    const matchRatio = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
    
    // Hard exclusion check
    const excludeWords = Object.entries(exclusions).find(([key]) => foodName.toLowerCase().includes(key))?.[1] || [];
    const isExcluded = excludeWords.some((w: string) => desc.includes(w));
    
    // Prefer Foundation data (more verified)
    const typeScore = f.dataType === "Foundation" ? 3 : f.dataType === "SR Legacy" ? 2 : 1;
    
    // Penalize raw when we want cooked (and vice versa) — but only if query specifies
    const wantsCooked = foodName.toLowerCase().includes("cooked") || foodName.toLowerCase().includes("broiled") || foodName.toLowerCase().includes("roasted");
    const isRaw = desc.includes("raw");
    const cookPenalty = wantsCooked && isRaw ? -3 : 0;
    
    const score = isExcluded ? -999 : (matchRatio * 10) + typeScore + cookPenalty;
    return { food: f, score, desc };
  });

  scored.sort((a: any, b: any) => b.score - a.score);
  
  // Log top matches for debugging
  console.log(`[USDA] "${foodName}" top matches:`, scored.slice(0, 3).map((s: any) => `"${s.desc}" (${s.score.toFixed(1)})`).join(", "));
  
  const best = scored[0].food;

  // Extract nutrients per 100g
  const getNutrient = (id: number) => {
    const n = (best.foodNutrients || []).find(
      (n: any) => n.nutrientId === id || n.nutrientNumber === String(id)
    );
    return n?.value || n?.amount || 0;
  };

  const per100 = {
    calories: getNutrient(1008) || getNutrient(2047),
    protein:  getNutrient(1003),
    carbs:    getNutrient(1005),
    fats:     getNutrient(1004),
    fiber:    getNutrient(1079),
    sugar:    getNutrient(2000),
  };

  // Use Gemini-provided grams directly — it's more accurate than our parsing
  const portionGrams = grams > 0 ? grams : fallbackGrams(portionStr, foodName, best);
  const ratio = portionGrams / 100;

  return {
    name: best.description,
    originalName: foodName,
    portion: portionStr,
    grams: Math.round(portionGrams),
    calories: Math.round(per100.calories * ratio),
    protein:  Math.round(per100.protein  * ratio * 10) / 10,
    carbs:    Math.round(per100.carbs    * ratio * 10) / 10,
    fats:     Math.round(per100.fats     * ratio * 10) / 10,
    fiber:    Math.round(per100.fiber    * ratio * 10) / 10,
    sugar:    Math.round(per100.sugar    * ratio * 10) / 10,
    dataType: best.dataType,
    usdaDesc: best.description,
  };
}

function fallbackGrams(portion: string, foodName: string, usdaItem: any): number {
  const p = portion.toLowerCase();
  const food = foodName.toLowerCase();
  const num = parseFloat(p.match(/[\d.]+/)?.[0] || "1");

  if (p.match(/\d+\s*g\b/))     return num;
  if (p.includes("oz"))          return Math.round(num * 28.35);
  if (p.includes("lb"))          return Math.round(num * 453.6);
  if (p.includes("cup"))         return 240 * num;
  if (p.includes("tbsp"))        return 15 * num;
  if (p.includes("tsp"))         return 5 * num;
  if (p.includes("scoop"))       return 35 * num;
  if (usdaItem?.servingSize)     return num * usdaItem.servingSize;
  if (food.includes("egg"))      return 50 * num;
  if (food.includes("patty") || food.includes("burger")) return 85 * num;
  if (food.includes("potato"))   return 100 * num;
  if (food.includes("chicken"))  return 140 * num;
  if (food.includes("rice") || food.includes("pasta") || food.includes("oat")) return 180 * num;
  return 100 * num;
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
    if (!usdaKey)   return new Response(JSON.stringify({ error: "USDA key not configured" }),   { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });

    const meal  = body.meal  || "";
    const image = body.type === "scan" ? body.image : null;

    if (body.type === "scan" && !image?.base64) {
      return new Response(JSON.stringify({ error: "Missing image data" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Step 1: Gemini identifies foods with grams
    console.log(`[${body.type}] Step 1 — identifying: "${meal}"`);
    const identified = await identifyFoods(meal, image, geminiKey);
    console.log(`[${body.type}] Identified ${identified.length} items:`, identified.map((i: any) => `${i.food} (${i.grams}g)`).join(", "));

    // Step 2: USDA lookups in parallel
    const lookups = await Promise.all(
      identified.map((item: any) => usdaLookup(item.food, item.portion, item.grams || 0, usdaKey))
    );
    const valid = lookups.filter(Boolean) as any[];

    if (!valid.length) {
      return new Response(
        JSON.stringify({ error: "Could not find these foods in the USDA database. Try simpler descriptions — e.g. 'chocolate cupcake' instead of 'bite size cupcake', or use Manual Entry for packaged foods." }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Sum all items
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

    // Build meal name
    const mealName = image
      ? valid.map((v) => v.originalName).join(", ")
      : (meal.length > 80 ? meal.substring(0, 80) + "..." : meal);

    const food = {
      name: mealName,
      portion: valid.map((v) => `${v.portion}`).join(" + "),
      ...total,
      rating: 4,
      source: "USDA FoodData Central",
      // Always include items breakdown so user can verify each food
      items: valid.map((v) => ({
        name: v.usdaDesc,
        portion: `${v.grams}g`,
        calories: v.calories,
        protein: v.protein,
        carbs: v.carbs,
        fats: v.fats,
      })),
      insights: [
        `${valid.length} food${valid.length > 1 ? "s" : ""} verified via USDA FoodData Central`,
        `P: ${total.protein}g (${Math.round(total.protein * 4)} kcal) · C: ${total.carbs}g (${Math.round(total.carbs * 4)} kcal) · F: ${total.fats}g (${Math.round(total.fats * 9)} kcal)`,
      ],
    };

    console.log(`[${body.type}] Result: ${food.calories} kcal, ${food.protein}g protein`);
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
