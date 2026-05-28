// supabase/functions/verify-stripe-session/index.ts
// Deploy: supabase functions deploy verify-stripe-session
// Secret:  supabase secrets set STRIPE_SECRET_KEY=sk_live_...

import Stripe from "https://esm.sh/stripe@13.6.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
});

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://fitfriendchris.github.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Pre-flight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Authenticate caller ─────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

  if (!user || authError) {
    return new Response(
      JSON.stringify({ verified: false, error: "Unauthorized — sign in required" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let body: { sessionId?: string; plan?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ verified: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { sessionId, plan } = body;

  // Basic validation
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return new Response(
      JSON.stringify({ verified: false, error: "Invalid session ID format" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!plan || !["core", "elite", "vip", "diamond"].includes(plan)) {
    return new Response(
      JSON.stringify({ verified: false, error: "Invalid plan" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Must be paid
    if (session.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ verified: false, error: "Payment not completed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Plan must match what's encoded in metadata or client_reference_id
    const metaPlan = session.metadata?.plan;
    const refPlan  = session.client_reference_id?.split("__")[1]; // format: email__plan
    const confirmedPlan = metaPlan || refPlan;

    if (confirmedPlan && confirmedPlan !== plan) {
      return new Response(
        JSON.stringify({ verified: false, error: "Plan mismatch" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the email matches the authenticated user
    const sessionEmail = session.customer_email || session.customer_details?.email || "";
    if (sessionEmail && sessionEmail.toLowerCase() !== user.email!.toLowerCase()) {
      console.warn(`Email mismatch: expected ${user.email}, got ${sessionEmail}`);
      return new Response(
        JSON.stringify({ verified: false, error: "Session email does not match authenticated user" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        verified: true,
        plan: confirmedPlan || plan,
        sessionId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Stripe verification error:", err);
    return new Response(
      JSON.stringify({ verified: false, error: "Payment verification failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
