import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const JSON_SCHEMA = `{
  "name": string,
  "portion": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "fiber": number,
  "sugar": number
}`;

const STRICT_SYSTEM_PROMPT = `You are a precise sports nutrition database. You return USDA/NCCDB standard macro values.
Rules:
- Use USDA FoodData Central as your reference for all values
- Return ONLY valid JSON matching the schema — no markdown, no explanation, no extra fields
- calories must equal: (protein * 4) + (carbs * 4) + (fats * 9), rounded to nearest 5
- All numbers must be integers or one decimal place maximum
- portion must be specific: "6 oz", "1 cup (240ml)", "2 slices (60g)" — never vague
- If multiple foods are described, sum all macros into a single combined entry
- name should be the full meal description, max 60 chars`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();

    // ── TEXT ANALYSIS (AI Log tab) ──────────────────────────────
    if (body.type === "text") {
      const groqKey = Deno.env.get("GROQ_API_KEY");
      if (!groqKey) return new Response(JSON.stringify({ error: "Groq key not set" }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });

      const meal = body.meal || "";
      const ctx  = body.userContext || {};

      const prompt = `Calculate the exact macros for this meal using USDA FoodData Central values:
"${meal}"

User context (for portion guidance only, do not adjust macros):
- Body weight: ${ctx.weight || "unknown"}lbs
- Goal: ${ctx.goal || "maintenance"}

Return ONLY this JSON schema, no other text:
${JSON_SCHEMA}`;

      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + groqKey },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: STRICT_SYSTEM_PROMPT },
            { role: "user",   content: prompt }
          ],
          temperature: 0,       // deterministic — same input = same output every time
          max_tokens: 400,
          response_format: { type: "json_object" },
        }),
      });

      const d = await r.json();
      if (d.error) throw new Error(d.error.message || "Groq error");
      const text = d.choices?.[0]?.message?.content || "";
      const food = JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
      return new Response(JSON.stringify({ ok: true, food }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ── PHOTO SCAN (Scan tab) ───────────────────────────────────
    if (body.type === "scan") {
      const geminiKey = Deno.env.get("GEMINI_API_KEY");
      if (!geminiKey) return new Response(JSON.stringify({ error: "Gemini key not set" }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });

      const img = body.image;
      if (!img?.base64) return new Response(JSON.stringify({ error: "Missing image" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

      const mt = ["image/jpeg","image/png","image/webp","image/gif"].includes(img.mediaType) ? img.mediaType : "image/jpeg";

      const scanPrompt = `You are a precise sports nutrition database. Identify every food visible in this photo and return combined macros using USDA FoodData Central standard values.

Return ONLY this JSON schema, no markdown, no explanation:
${JSON_SCHEMA}

Rules:
- Estimate portion sizes from visual cues (plate size, hand reference, packaging)
- calories must equal: (protein * 4) + (carbs * 4) + (fats * 9), rounded to nearest 5
- All numbers must be integers or one decimal place maximum
- If you cannot identify the food, use your best estimate and note it in the name field`;

      const r = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=" + geminiKey,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: mt, data: img.base64 } },
              { text: scanPrompt }
            ]}],
            generationConfig: { temperature: 0, maxOutputTokens: 400 },
          }),
        }
      );

      const d = await r.json();
      if (d.error) throw new Error(d.error.message || "Gemini error");
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const food = JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
      return new Response(JSON.stringify({ ok: true, food }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "type must be scan or text" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (err) {
    const m = err instanceof Error ? err.message : "Failed";
    console.error("[analyze-food error]", m);
    return new Response(JSON.stringify({ error: m }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
