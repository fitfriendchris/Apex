import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ALLOWED_ORIGINS = [
  "https://apexcoaching.app",
  "https://apex-356.pages.dev",
  "https://fitfriendchris.github.io",
  "http://localhost:8888",
  "http://localhost:3000",
];

// ── Coach emails authorized to receive COACH_SECRET ──────────────────────────
// Only these emails get the coach secret in the config response.
// Everyone else gets public config only (Supabase URL, anon key, Stripe links).
const COACH_EMAILS = new Set([
  "fitfriendchris@gmail.com",
]);

serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Public config (GET) — returned to all callers ──────────────────────────
  if (req.method === "GET") {
    const config = {
      supabaseUrl:     Deno.env.get("SUPABASE_URL")      ?? "",
      supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      stripeLinks: {
        core:    Deno.env.get("STRIPE_LINK_CORE")    ?? "",
        elite:   Deno.env.get("STRIPE_LINK_ELITE")   ?? "",
        vip:     Deno.env.get("STRIPE_LINK_VIP")     ?? "",
        diamond: Deno.env.get("STRIPE_LINK_DIAMOND") ?? "",
      },
    };

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // ── Coach auth (POST) — validates password server-side, returns secret ─────
  // The client sends { password } and we compare against COACH_SECRET env var.
  // This replaces the old pattern of sending the secret to every client.
  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const password = String(body.password ?? "");
    const coachSecret = Deno.env.get("COACH_SECRET") ?? "";

    if (!password || !coachSecret || password !== coachSecret) {
      return new Response(JSON.stringify({ error: "Invalid coach password" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Password matches — return the secret so the client can use it for
    // X-Coach-Token headers on subsequent API calls.
    return new Response(JSON.stringify({ coachSecret }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
}, { port: 8000 });
