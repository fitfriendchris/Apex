import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://fitfriendchris.github.io";

// ── Coach emails authorized to receive COACH_SECRET ──────────────────────────
const COACH_EMAILS = new Set([
  "fitfriendchris@gmail.com",
]);

// ── In-memory rate limiter for coach auth attempts ────────────────────────────
const MAX_IP_ENTRIES = 500;
const ipCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (ipCounts.size >= MAX_IP_ENTRIES) {
    for (const [key, val] of ipCounts) {
      if (now > val.resetAt) ipCounts.delete(key);
    }
    if (ipCounts.size >= MAX_IP_ENTRIES) {
      const oldestKey = ipCounts.keys().next().value;
      if (oldestKey) ipCounts.delete(oldestKey);
    }
  }
  const record = ipCounts.get(ip);
  if (!record || now > record.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + 60_000 }); // 1-min window
    return true;
  }
  if (record.count >= 5) return false; // 5 attempts per minute per IP
  record.count++;
  return true;
}

serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
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
        core:     Deno.env.get("STRIPE_LINK_CORE")     ?? "",
        elite:    Deno.env.get("STRIPE_LINK_ELITE")    ?? "",
        vip:      Deno.env.get("STRIPE_LINK_VIP")      ?? "",
        diamond:  Deno.env.get("STRIPE_LINK_DIAMOND")  ?? "",
        ai_basic: Deno.env.get("STRIPE_LINK_APEX_AI_FEATURES") ?? "",
      },
    };

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // ── Coach auth (POST) — validates password server-side, returns secret ─────
  if (req.method === "POST") {
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    if (!clientIP || !checkRateLimit(clientIP)) {
      return new Response(JSON.stringify({ error: "Too many attempts — slow down" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    return new Response(JSON.stringify({ coachSecret }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
}, { port: 8000 });
