import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ALLOWED_ORIGINS = [
  "https://fitfriendchris.github.io",
  "http://localhost:8888",
  "http://localhost:3000",
];

serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  const config = {
    supabaseUrl:     Deno.env.get("SUPABASE_URL")      ?? "",
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    coachSecret:     Deno.env.get("COACH_SECRET")      ?? "",
    stripeLinks: {
      core:    Deno.env.get("STRIPE_LINK_CORE")    ?? "",
      elite:   Deno.env.get("STRIPE_LINK_ELITE")   ?? "",
      vip:     Deno.env.get("STRIPE_LINK_VIP")     ?? "",
      diamond: Deno.env.get("STRIPE_LINK_DIAMOND") ?? "",
    },
  };

  return new Response(JSON.stringify(config), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
});
