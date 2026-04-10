// supabase/functions/verify-stripe-session/index.ts
// Deploy: supabase functions deploy verify-stripe-session
// Secret:  supabase secrets set STRIPE_SECRET_KEY=sk_live_...

import Stripe from "https://esm.sh/stripe@13.6.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
});

const ALLOWED_ORIGIN = "https://apexcoaching.app"; // ← change if your domain differs

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

  let body: { sessionId?: string; plan?: string; userEmail?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ verified: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { sessionId, plan, userEmail } = body;

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

    // Optional: verify the email matches if provided
    if (userEmail && session.customer_email && session.customer_email !== userEmail) {
      console.warn(`Email mismatch: expected ${userEmail}, got ${session.customer_email}`);
      // Warn but don't block — prefilled email can differ from Stripe account email
    }

    return new Response(
      JSON.stringify({
        verified: true,
        plan: confirmedPlan || plan,
        sessionId,
        customerEmail: session.customer_email,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Stripe verification error:", err);
    return new Response(
      JSON.stringify({ verified: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
