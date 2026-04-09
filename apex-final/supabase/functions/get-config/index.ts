// supabase/functions/get-config/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Serves all runtime configuration the client needs at boot time.
// Keeps every secret and key off the HTML file entirely.
//
// Deploy:
//   supabase functions deploy get-config
//
// Set these secrets:
//   supabase secrets set COACH_SECRET=your_coach_password_here      ← server-side only, never returned
//   supabase secrets set STRIPE_CORE_LINK=https://buy.stripe.com/...
//   supabase secrets set STRIPE_ELITE_LINK=https://buy.stripe.com/...
//   supabase secrets set STRIPE_VIP_LINK=https://buy.stripe.com/...
//   supabase secrets set STRIPE_DIAMOND_LINK=https://buy.stripe.com/...
//   supabase secrets set STRIPE_AI_BASIC_LINK=https://buy.stripe.com/...
//   supabase secrets set STRIPE_PORTAL_URL=https://billing.stripe.com/...
//   supabase secrets set USDA_API_KEY=your_usda_key_here  (optional)
//   supabase secrets set ALLOWED_ORIGIN=https://apexcoaching.app
//
// SECURITY NOTE: COACH_SECRET is intentionally NOT returned here.
// The coach enters their password via the in-app coach-mode modal. The password
// is validated server-side by each edge function that requires coach access
// (via the X-Coach-Token header). If the token is wrong, the API returns 401.
// Returning the secret here would expose it to any anonymous visitor.
//
// The Supabase URL and anon key are safe to expose — they are designed
// to be public. RLS policies protect the data, not the anon key.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://apexcoaching.app";

const corsHeaders = {
  "Access-Control-Allow-Origin":  allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // Cache config for 5 minutes in the browser to reduce cold-start latency
  "Cache-Control": "public, max-age=300",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const config = {
      // ── Supabase (public — safe to expose, RLS protects the data) ──────────
      supabaseUrl:     Deno.env.get("SUPABASE_URL")      ?? "",
      supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",

      // ── COACH_SECRET is intentionally omitted ───────────────────────────────
      // Coach authentication is validated server-side only. The coach enters
      // their password in the app; it is sent as X-Coach-Token and verified by
      // each edge function against the COACH_SECRET env var. It is never sent
      // to the client. Any coachSecret field here would be a security bug.

      // ── Stripe payment links ─────────────────────────────────────────────────
      stripeLinks: {
        ai_basic: Deno.env.get("STRIPE_AI_BASIC_LINK") ?? "",
        core:     Deno.env.get("STRIPE_CORE_LINK")     ?? "",
        elite:    Deno.env.get("STRIPE_ELITE_LINK")    ?? "",
        vip:      Deno.env.get("STRIPE_VIP_LINK")      ?? "",
        diamond:  Deno.env.get("STRIPE_DIAMOND_LINK")  ?? "",
      },

      // ── Stripe Customer Portal (self-serve billing management) ──────────────
      stripePortalUrl: Deno.env.get("STRIPE_PORTAL_URL") ?? "",

      // ── USDA FoodData Central API key (optional — for barcode fallback) ─────
      usdaApiKey: Deno.env.get("USDA_API_KEY") ?? "",

      // ── Feature flags (server-controlled) ───────────────────────────────────
      features: {
        aiScanner:    Deno.env.get("FEATURE_AI_SCANNER")     !== "false",
        aiMealLogger: Deno.env.get("FEATURE_AI_MEAL_LOGGER") !== "false",
        scheduling:   Deno.env.get("FEATURE_SCHEDULING")     !== "false",
        course:       Deno.env.get("FEATURE_COURSE")         !== "false",
        store:        Deno.env.get("FEATURE_STORE")          !== "false",
        referrals:    Deno.env.get("FEATURE_REFERRALS")      === "true",
        leaderboard:  Deno.env.get("FEATURE_LEADERBOARD")    === "true",
      },

      // ── Server timestamp (used for session expiry validation) ────────────────
      serverTime: new Date().toISOString(),
    };

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  } catch (err) {
    console.error("get-config error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to load config" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
