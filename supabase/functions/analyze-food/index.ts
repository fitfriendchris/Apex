const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
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
function extractJSON(raw) {
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(s); } catch (_) {}
  const arrStart = s.indexOf("[");
  const objStart = s.indexOf("{");
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const arrEnd = s.lastIndexOf("]");
    if (arrEnd > arrStart) { try { return JSON.parse(s.slice(arrStart, arrEnd + 1)); } catch (_) {} }
    try { return JSON.parse(s.slice(arrStart) + "]"); } catch (_) {}
  }
  if (objStart !== -1) {
    const objEnd = s.lastIndexOf("}");
    if (objEnd > objStart) { try { return JSON.parse(s.slice(objStart, objEnd + 1)); } catch (_) {} }
  }
  throw new Error("Could not parse JSON from: " + raw.slice(0, 200));
}
function buildFoodObject(items, name) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Empty food array");
  const totals = { calories:0,protein:0,carbs:0,fats:0,fiber:0,vitaminA:0,vitaminC:0,vitaminD:0,vitaminE:0,calcium:0,iron:0,magnesium:0,zinc:0,potassium:0,sodium:0,omega3:0,folate:0,b12:0,selenium:0 };
  for (const item of items) { for (const key of Object.keys(totals)) { totals[key] += parseFloat(String(item[key] || 0)) || 0; } }
  for (const k of Object.keys(totals)) { totals[k] = Math.round(totals[k] * 10) / 10; }
  const insights = [
    totals.protein + "g protein · " + totals.carbs + "g carbs · " + totals.fats + "g fat",
    totals.fiber > 3 ? "Good fiber source (" + totals.fiber + "g)" : "Low fiber — consider adding veggies",
    totals.sodium > 800 ? "High sodium (" + totals.sodium + "mg)" : "Sodium: " + totals.sodium + "mg",
  ];
  return { name, portion: items.length > 1 ? items.length + " items" : "1 serving", category: "meal", ...totals, insights, items: items.map(i => ({ food: i.food || i.name || "Unknown", grams: i.grams || 100, calories: Math.round(parseFloat(String(i.calories||0))), protein: Math.round(parseFloat(String(i.protein||0))*10)/10, carbs: Math.round(parseFloat(String(i.carbs||0))*10)/10, fats: Math.round(parseFloat(String(i.fats||0))*10)/10 })) };
}
async function analyzeText(meal, userContext) {
  const prompt = `You are a precise nutrition analyzer. The user ate: "${meal}"\n\nReturn ONLY a JSON array of food items. No explanation, no markdown, no preamble. Each item must have ALL these fields (use 0 if unknown):\nfood, grams, calories, protein, carbs, fats, fiber, vitaminA, vitaminC, vitaminD, vitaminE, calcium, iron, magnesium, zinc, potassium, sodium, omega3, folate, b12, selenium\n\nStart your response with [ and end with ]. Nothing before or after.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{"x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","content-type":"application/json"}, body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:1500, messages:[{role:"user",content:prompt}] }) });
  if (!res.ok) throw new Error("Anthropic error: " + res.status);
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const items = extractJSON(text);
  return buildFoodObject(Array.isArray(items) ? items : [items], meal);
}
async function analyzePhoto(base64, mediaType) {
  const prompt = `Analyze this food photo. Return ONLY a valid JSON array. No markdown, no explanation. Each object must have: food, grams, calories, protein, carbs, fats, fiber, vitaminA, vitaminC, vitaminD, vitaminE, calcium, iron, magnesium, zinc, potassium, sodium, omega3, folate, b12, selenium. Start with [ and end with ].`;
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + GEMINI_KEY, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ contents:[{parts:[{text:prompt},{inline_data:{mime_type:mediaType,data:base64}}]}], generationConfig:{temperature:0.1,maxOutputTokens:2000} }) });
  if (!res.ok) throw new Error("Gemini error: " + res.status);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  try {
    const items = extractJSON(text);
    return buildFoodObject(Array.isArray(items) ? items : [items], "Scanned meal");
  } catch(e) {
    return await analyzePhotoFallback(base64, mediaType);
  }
}
async function analyzePhotoFallback(base64, mediaType) {
  const res = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{"x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","content-type":"application/json"}, body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:1500, messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:mediaType,data:base64}},{type:"text",text:"Analyze this food photo. Return ONLY a JSON array starting with [ and ending with ]. Fields: food,grams,calories,protein,carbs,fats,fiber,vitaminA,vitaminC,vitaminD,vitaminE,calcium,iron,magnesium,zinc,potassium,sodium,omega3,folate,b12,selenium"}]}] }) });
  if (!res.ok) throw new Error("Anthropic vision error: " + res.status);
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const items = extractJSON(text);
  return buildFoodObject(Array.isArray(items) ? items : [items], "Scanned meal");
}
Deno.serve(async (req) => {
  const cors = getCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const { type, meal, image, userContext } = body;
    let food;
    if (type === "scan" && image?.base64) { food = await analyzePhoto(image.base64, image.mediaType || "image/jpeg"); }
    else if (type === "text" && meal) { food = await analyzeText(meal, userContext || {}); }
    else { return new Response(JSON.stringify({ error: "Invalid request" }), { status:400, headers:{...cors,"Content-Type":"application/json"} }); }
    return new Response(JSON.stringify({ food }), { status:200, headers:{...cors,"Content-Type":"application/json"} });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status:500, headers:{...cors,"Content-Type":"application/json"} });
  }
});
