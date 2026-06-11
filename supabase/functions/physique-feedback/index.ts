// physique-feedback — Sprint 4: AI feedback on progress/check-in photos.
// POST { image: base64, mediaType: "image/jpeg"|"image/png", context?: { goal, weekNumber, lastWeight } }
// Auth enforced in-code (verify_jwt false to allow CORS preflight, matching analyze-food).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = Deno.env.get("AI_GATEWAY_URL") || "https://api.anthropic.com/v1/messages";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "https://fitfriendchris.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);
function buildCors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function jsonError(cors: Record<string, string>, message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You are an elite physique coach reviewing a client's progress photo. Give honest,
specific, encouraging feedback an experienced coach would give. NEVER estimate body-fat percentage
as a precise number, never comment negatively on appearance beyond training-relevant observations,
and never give medical advice. Focus on: visible development by muscle group, symmetry/balance,
posing/photo-quality tips for better tracking, and what to emphasise in training next.
Respond with ONLY valid JSON:
{
  "headline": "string",            // one encouraging, specific sentence
  "observations": ["string"],      // 2-4 training-relevant observations
  "focusNext": ["string"],         // 1-3 concrete training emphases
  "photoTips": ["string"],         // 0-2 tips for more consistent progress photos
  "coachNote": "string"            // 2-3 sentence motivating note in a direct coaching voice
}`;

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return jsonError(cors, "ANTHROPIC_API_KEY not configured", 500);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supa.auth.getUser();
    if (authErr || !user) return jsonError(cors, "Unauthorized", 401);

    // Tier gate + daily limit (same server-side truth as weekly-analyst)
    let tier = "free";
    try {
      const { data: row } = await supa.from("users").select("tier").eq("email", user.email).single();
      tier = (row?.tier ?? "free") as string;
    } catch { /* default free */ }
    const LIMITS: Record<string, number> = { free: 0, ai_basic: 3, core: 5, elite: 10, vip: 20, diamond: 999 };
    const limit = LIMITS[tier] ?? 0;
    if (limit === 0) return jsonError(cors, "Physique feedback requires a paid plan.", 403);
    const today = new Date().toISOString().split("T")[0];
    try {
      const { data: usage } = await supa.from("daily_ai_usage").select("scan_count")
        .eq("user_email", user.email).eq("usage_date", today).single();
      if (((usage?.scan_count ?? 0) as number) >= limit) {
        return jsonError(cors, "Daily AI limit reached", 429);
      }
    } catch { /* first call of the day */ }

    const body = await req.json().catch(() => ({}));
    const image = typeof body?.image === "string" ? body.image : "";
    const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(body?.mediaType) ? body.mediaType : "image/jpeg";
    if (!image || image.length < 100) return jsonError(cors, "image (base64) required", 400);
    if (image.length > 6_500_000) return jsonError(cors, "Image too large — compress below ~5MB", 413);
    const ctx = body?.context ?? {};

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: `Client goal: ${ctx.goal ?? "unspecified"}. Week ${ctx.weekNumber ?? "?"} in program. Return the JSON feedback now.` },
          ],
        }],
      }),
    });
    if (!res.ok) return jsonError(cors, "AI analysis failed", 502);
    const ai = await res.json();
    const raw = (ai.content?.[0]?.text ?? "").replace(/```json\n?|```\n?/g, "").trim();
    let feedback: Record<string, unknown>;
    try { feedback = JSON.parse(raw); } catch { return jsonError(cors, "Failed to parse AI feedback", 422); }

    try { await supa.rpc("increment_ai_usage", { p_email: user.email, p_date: today }); } catch { /* non-fatal */ }

    return new Response(JSON.stringify({ feedback }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
