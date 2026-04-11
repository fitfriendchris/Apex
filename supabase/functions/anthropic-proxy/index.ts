// supabase/functions/anthropic-proxy/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Secure server-side relay for Anthropic API calls.
// Keeps ANTHROPIC_API_KEY off the client entirely.
//
// Deploy:
//   supabase functions deploy anthropic-proxy
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set ALLOWED_ORIGIN=https://apexcoaching.app
//
// The client sends a standard Anthropic messages payload (minus the API key).
// This function validates the caller is authenticated, applies rate-limiting,
// forwards the request to Anthropic, and returns the response.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// ── Allowed models (prevent cost abuse via model choice) ──────────────────────
// Keep both the pinned snapshot (for stability) and newer versions.
const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-5-20250929",   // current recommended production snapshot
  "claude-sonnet-4-20250514",      // legacy — keep for backward compat
  "claude-haiku-4-5-20251001",
]);

// ── Per-user per-day call limit (server-side enforcement) ─────────────────────
const MAX_CALLS_PER_DAY: Record<string, number> = {
  free:     0,
  ai_basic: 50,
  core:     100,
  elite:    200,
  vip:      500,
  diamond:  9999,
};

// ── CORS — driven by ALLOWED_ORIGIN env var set via supabase secrets ──────────
// NEVER hardcode the domain in source — it changes between staging and prod.
const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://apexcoaching.app";
const corsHeaders = {
  "Access-Control-Allow-Origin":  allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-coach-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // ── Authenticate caller ─────────────────────────────────────────────────
    // Two valid paths:
    //   1. Supabase JWT  — regular authenticated users
    //   2. Coach token   — X-Coach-Token header matching COACH_SECRET env var
    //
    // The former X-Session-Token fallback was removed: it accepted ANY non-empty
    // string, making it trivially bypassable. Require proper auth.

    const authHeader  = req.headers.get("Authorization") ?? "";
    const coachToken  = req.headers.get("X-Coach-Token") ?? "";
    const validCoachToken = Deno.env.get("COACH_SECRET") ?? "";

    const isCoach = validCoachToken.length > 8 && coachToken === validCoachToken;

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError && !isCoach) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — valid Supabase session or coach token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Parse and validate request body ────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { model, max_tokens, messages, system } = body as {
      model: string;
      max_tokens: number;
      messages: unknown[];
      system?: string;
    };

    // ── Validate model ──────────────────────────────────────────────────────
    if (!ALLOWED_MODELS.has(model)) {
      return new Response(
        JSON.stringify({ error: `Model '${model}' is not permitted. Allowed: ${[...ALLOWED_MODELS].join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Validate max_tokens (cap to prevent runaway cost) ──────────────────
    const safeMaxTokens = Math.min(Number(max_tokens) || 1000, 4096);

    // ── Validate messages array ─────────────────────────────────────────────
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages must be a non-empty array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Rate limit check ────────────────────────────────────────────────────
    // Two-phase approach: check tier first (fast), then query usage table.
    // This ensures free-tier users are blocked even if the usage table is missing.
    if (user?.email) {
      let tier = "free";
      try {
        const { data: userRow } = await supabaseClient
          .from("users")
          .select("tier")
          .eq("email", user.email)
          .single();
        tier = (userRow?.tier ?? "free") as string;
      } catch {
        // users table read failed — default to free tier (fail closed)
        console.warn("Could not read user tier — defaulting to free");
      }

      const limit = MAX_CALLS_PER_DAY[tier] ?? 0;

      // Free tier: block immediately without touching usage table
      if (limit === 0) {
        return new Response(
          JSON.stringify({
            error: "AI features are not available on the Free plan. Upgrade to access AI.",
            code: "QUOTA_EXCEEDED",
            used: 0,
            limit: 0,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Paid tier: check daily usage counter
      try {
        const today = new Date().toISOString().split("T")[0];
        const { data: usageRow } = await supabaseClient
          .from("daily_ai_usage")
          .select("scan_count")
          .eq("user_email", user.email)
          .eq("usage_date", today)
          .single();

        const calls = (usageRow?.scan_count ?? 0) as number;
        if (calls >= limit) {
          return new Response(
            JSON.stringify({
              error: `Daily AI limit reached (${calls}/${limit}). Upgrade or wait until midnight.`,
              code: "QUOTA_EXCEEDED",
              used: calls,
              limit,
            }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch {
        // Table might not exist yet — skip usage check for paid tiers, don't fail the request
        console.warn("daily_ai_usage table not accessible — skipping usage check for paid tier");
      }
    }

    // ── Forward to Anthropic ───────────────────────────────────────────────
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured on the server" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anthropicPayload: Record<string, unknown> = {
      model,
      max_tokens: safeMaxTokens,
      messages,
    };
    if (system) anthropicPayload.system = system;

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         anthropicKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(anthropicPayload),
    });

    // ── Increment usage counter ───────────────────────────────────────────
    if (user?.email && anthropicRes.ok) {
      try {
        const today = new Date().toISOString().split("T")[0];
        await supabaseClient.rpc("increment_ai_usage", {
          p_email: user.email,
          p_date:  today,
        });
      } catch {
        // Non-fatal — usage tracking failure should not block the response
      }
    }

    // ── Return response ───────────────────────────────────────────────────
    const responseBody = await anthropicRes.json();

    return new Response(JSON.stringify(responseBody), {
      status: anthropicRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  } catch (err) {
    console.error("anthropic-proxy error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
