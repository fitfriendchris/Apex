import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

// Search USDA for a food and return the best match's nutrients
async function usdaSearch(query: string, apiKey: string) {
  const url = `${USDA_BASE}/foods/search?query=${encodeURIComponent(query)}&dataType=SR%20Legacy,Foundation,Survey%20(FNDDS)&pageSize=5&api_key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.foods || [];
}

// Extract macros from a USDA food item's nutrients array
function extractNutrients(foodNutrients: any[]) {
  const get = (id: number) => {
    const n = foodNutrients.find((n: any) => n.nutrientId === id || n.nutrientNumber === String(id));
    return Math.round((n?.value || n?.amount || 0) * 10) / 10;
  };
  return {
    calories: Math.round(get(1008) || get(2047) || 0),
    protein:  Math.round(get(1003) * 10) / 10,
    carbs:    Math.round(get(1005) * 10) / 10,
    fats:     Math.round(get(1004) * 10) / 10,
    fiber:    Math.round(get(1079) * 10) / 10,
    sugar:    Math.round(get(2000) * 10) / 10,
  };
}

// Parse a meal description into food + quantity parts
// e.g. "2 eggs scrambled" → [{food:"eggs scrambled", multiplier:2, unit:"whole"}]
// e.g. "150g chicken breast" → [{food:"chicken breast", grams:150}]
function parseMealParts(meal: string): Array<{query: string, grams?: number, multiplier?: number}> {
  const parts = meal.split(/,|and|\+/i).map(s => s.trim()).filter(Boolean);
  return parts.map(part => {
    // Match "Xg" or "X grams"
    const gramsMatch = part.match(/^(\d+\.?\d*)\s*g(?:rams?)?\s+(.+)$/i);
    if (gramsMatch) return { query: gramsMatch[2].trim(), grams: parseFloat(gramsMatch[1]) };

    // Match "X oz"
    const ozMatch = part.match(/^(\d+\.?\d*)\s*oz\s+(.+)$/i);
    if (ozMatch) return { query: ozMatch[2].trim(), grams: parseFloat(ozMatch[1]) * 28.35 };

    // Match "X cup(s)"
    const cupMatch = part.match(/^(\d+\.?\d*)\s*cups?\s+(.+)$/i);
    if (cupMatch) return { query: cupMatch[2].trim(), multiplier: parseFloat(cupMatch[1]), unit: 'cup' };

    // Match leading number e.g. "2 eggs" "3 slices bread"
    const countMatch = part.match(/^(\d+\.?\d*)\s+(.+)$/);
    if (countMatch) return { query: countMatch[2].trim(), multiplier: parseFloat(countMatch[1]) };

    return { query: part, multiplier: 1 };
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const apiKey = Deno.env.get("USDA_API_KEY") || "";

    // ── PHOTO SCAN — still uses Gemini (USDA can't process images) ────────
    if (body.type === "scan") {
      const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";
      if (!geminiKey) return new Response(JSON.stringify({ error: "Gemini key not set" }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });

      const img = body.image;
      if (!img?.base64) return new Response(JSON.stringify({ error: "Missing image" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      const mt = ["image/jpeg","image/png","image/webp","image/gif"].includes(img.mediaType) ? img.mediaType : "image/jpeg";

      const prompt = `Identify every food in this photo with estimated portion sizes. Return ONLY valid JSON, no markdown:
{"name":"Full meal description","portion":"estimated total portion","calories":0,"protein":0,"carbs":0,"fats":0,"fiber":0,"sugar":0,"items":[{"name":"food item","portion":"4 oz","calories":0,"protein":0,"carbs":0,"fats":0}]}
Use USDA standard values. calories must equal (protein*4)+(carbs*4)+(fats*9) rounded to nearest 5.`;

      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mt, data: img.base64 } }, { text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 600 } }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || "Gemini error");
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const food = JSON.parse(text.replace(/```json\s*/g,"").replace(/```\s*/g,"").trim());
      return new Response(JSON.stringify({ ok: true, food }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ── TEXT ANALYSIS — USDA FoodData Central ────────────────────────────
    if (body.type === "text") {
      if (!apiKey) return new Response(JSON.stringify({ error: "USDA API key not set" }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });

      const meal = (body.meal || "").trim();
      const parts = parseMealParts(meal);

      // Query USDA for each part in parallel
      const results = await Promise.all(parts.map(async (part) => {
        const foods = await usdaSearch(part.query, apiKey);
        if (!foods.length) return null;

        // Pick the best match — prefer Foundation > SR Legacy > FNDDS
        const priority = ["Foundation","SR Legacy","Survey (FNDDS)","Branded"];
        const sorted = foods.sort((a: any, b: any) => priority.indexOf(a.dataType) - priority.indexOf(b.dataType));
        const best = sorted[0];

        // Get per-100g nutrients
        const per100 = extractNutrients(best.foodNutrients || []);

        // Calculate portion
        let grams = 100; // default per 100g
        if (part.grams) {
          grams = part.grams;
        } else if (part.multiplier && best.servingSize) {
          grams = part.multiplier * best.servingSize;
        } else if (part.multiplier) {
          // Estimate typical serving sizes for common foods
          const q = part.query.toLowerCase();
          if      (q.includes('egg'))    grams = part.multiplier * 50;
          else if (q.includes('slice'))  grams = part.multiplier * 30;
          else if (q.includes('cup'))    grams = part.multiplier * 240;
          else if (q.includes('tbsp'))   grams = part.multiplier * 15;
          else if (q.includes('tsp'))    grams = part.multiplier * 5;
          else if (q.includes('scoop'))  grams = part.multiplier * 35;
          else                           grams = part.multiplier * (best.servingSize || 100);
        }

        const ratio = grams / 100;
        return {
          name: best.description,
          portion: part.grams ? `${grams}g` : `${part.multiplier || 1} serving (${Math.round(grams)}g)`,
          calories: Math.round(per100.calories * ratio),
          protein:  Math.round(per100.protein  * ratio * 10) / 10,
          carbs:    Math.round(per100.carbs     * ratio * 10) / 10,
          fats:     Math.round(per100.fats      * ratio * 10) / 10,
          fiber:    Math.round(per100.fiber     * ratio * 10) / 10,
          sugar:    Math.round(per100.sugar     * ratio * 10) / 10,
          fdcId:    best.fdcId,
          dataType: best.dataType,
        };
      }));

      const valid = results.filter(Boolean) as any[];

      if (!valid.length) {
        return new Response(JSON.stringify({ error: `Could not find "${meal}" in USDA database. Try being more specific, e.g. "150g chicken breast" or "2 large eggs".` }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
      }

      // Sum all parts into one combined entry
      const combined = valid.reduce((acc, item) => ({
        calories: acc.calories + item.calories,
        protein:  Math.round((acc.protein  + item.protein)  * 10) / 10,
        carbs:    Math.round((acc.carbs    + item.carbs)    * 10) / 10,
        fats:     Math.round((acc.fats     + item.fats)     * 10) / 10,
        fiber:    Math.round((acc.fiber    + item.fiber)    * 10) / 10,
        sugar:    Math.round((acc.sugar    + item.sugar)    * 10) / 10,
      }), { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0, sugar: 0 });

      const food = {
        name: meal.length > 60 ? meal.substring(0, 60) : meal,
        portion: valid.map(v => v.portion).join(" + "),
        ...combined,
        rating: 4,
        source: "USDA FoodData Central",
        items: valid.length > 1 ? valid.map(v => ({ name: v.name, portion: v.portion, calories: v.calories, protein: v.protein, carbs: v.carbs, fats: v.fats })) : undefined,
        insights: [
          `Source: USDA FoodData Central (${valid.map(v => v.dataType).join(", ")})`,
          `${combined.protein}g protein = ${Math.round(combined.protein * 4)} kcal · ${combined.carbs}g carbs = ${Math.round(combined.carbs * 4)} kcal · ${combined.fats}g fats = ${Math.round(combined.fats * 9)} kcal`,
        ],
      };

      return new Response(JSON.stringify({ ok: true, food }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "type must be scan or text" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (err) {
    const m = err instanceof Error ? err.message : "Failed";
    console.error("[analyze-food]", m);
    return new Response(JSON.stringify({ error: m }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
