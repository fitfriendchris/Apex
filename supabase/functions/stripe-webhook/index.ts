// supabase/functions/stripe-webhook/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Stripe subscription-lifecycle webhook — the source of truth for tier state.
//
// verify-stripe-session grants a tier the moment a checkout succeeds (good for
// instant UX). This webhook keeps the tier CORRECT over time: it re-confirms new
// subscriptions and, crucially, DOWNGRADES users when a subscription is cancelled,
// expires, or goes unpaid — which nothing else in the system does today.
//
// Deploy (must skip JWT — Stripe cannot send a Supabase JWT):
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Secrets:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...   (from the Stripe dashboard)
//
// Stripe setup: Dashboard → Developers → Webhooks → Add endpoint
//   URL:    https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.deleted,
//           customer.subscription.updated, invoice.payment_failed
// ─────────────────────────────────────────────────────────────────────────────

import Stripe from "https://esm.sh/stripe@13.6.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  // Stripe's Deno build needs a Web-Crypto-backed HTTP client for async signature
  // verification (constructEventAsync below).
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

const VALID_TIERS = new Set(["free", "ai_basic", "core", "elite", "vip", "diamond"]);
const RANK: Record<string, number> = { free: 0, ai_basic: 1, core: 2, elite: 3, vip: 4, diamond: 5 };

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Resolve the plan a checkout session was for (matches verify-stripe-session).
function planFromSession(session: Stripe.Checkout.Session): string | null {
  const meta = session.metadata?.plan;
  const ref = session.client_reference_id?.split("__")[1]; // "email__plan"
  const plan = (meta || ref || "").toLowerCase();
  return VALID_TIERS.has(plan) && plan !== "free" ? plan : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return new Response("Webhook not configured", { status: 500 });
  }

  // ── Verify the Stripe signature over the RAW body ───────────────────────────
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody, signature, WEBHOOK_SECRET, undefined, cryptoProvider,
    );
  } catch (err) {
    console.error("Signature verification failed:", err instanceof Error ? err.message : err);
    return new Response("Invalid signature", { status: 400 });
  }

  const db = admin();

  try {
    switch (event.type) {
      // ── New / completed checkout → grant tier (upgrade-only) ────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status !== "paid" && session.status !== "complete") break;

        const email = (session.customer_email || session.customer_details?.email || "").toLowerCase();
        const plan = planFromSession(session);
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        if (!email || !plan) {
          console.warn("checkout.session.completed missing email/plan", { email, plan });
          break;
        }

        const { data: existing } = await db.from("users").select("tier").eq("email", email).single();
        const currentTier = (existing?.tier ?? "free") as string;
        const update: Record<string, unknown> = { stripe_session_id: session.id };
        if (customerId) update.stripe_customer_id = customerId;
        if ((RANK[plan] ?? 0) > (RANK[currentTier] ?? 0)) update.tier = plan;

        const { error } = await db.from("users").update(update).eq("email", email);
        if (error) throw error;
        console.log(`Granted ${plan} to ${email}`);
        break;
      }

      // ── Subscription cancelled / ended → downgrade to free ──────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        if (!customerId) break;
        const { error } = await db
          .from("users")
          .update({ tier: "free", tier_expires: null })
          .eq("stripe_customer_id", customerId);
        if (error) throw error;
        console.log(`Downgraded customer ${customerId} to free (subscription deleted)`);
        break;
      }

      // ── Subscription updated → downgrade on terminal states ─────────────────
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        if (!customerId) break;
        // canceled/unpaid/past_due (after retries) → revoke access now.
        if (["canceled", "unpaid"].includes(sub.status)) {
          const { error } = await db
            .from("users")
            .update({ tier: "free", tier_expires: null })
            .eq("stripe_customer_id", customerId);
          if (error) throw error;
          console.log(`Downgraded customer ${customerId} to free (status=${sub.status})`);
        }
        break;
      }

      // ── Payment failed → log only; Stripe retries, then fires subscription.* ─
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        console.warn(`invoice.payment_failed for customer ${inv.customer} (Stripe will retry)`);
        break;
      }

      default:
        // Ignore unsubscribed event types.
        break;
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    // 500 tells Stripe to retry — appropriate for transient DB errors.
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
