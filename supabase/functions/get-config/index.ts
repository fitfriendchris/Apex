import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
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
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
});
