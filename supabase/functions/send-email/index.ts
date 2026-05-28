import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://fitfriendchris.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── In-memory rate limiter: 10 emails per user per hour ───────────────────────
const MAX_ENTRIES = 500;
const userCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  if (userCounts.size >= MAX_ENTRIES) {
    for (const [k, v] of userCounts) {
      if (now > v.resetAt) userCounts.delete(k);
    }
    if (userCounts.size >= MAX_ENTRIES) {
      const oldest = userCounts.keys().next().value;
      if (oldest) userCounts.delete(oldest);
    }
  }
  const record = userCounts.get(key);
  if (!record || now > record.resetAt) {
    userCounts.set(key, { count: 1, resetAt: now + 3_600_000 }); // 1-hour window
    return true;
  }
  if (record.count >= 10) return false;
  record.count++;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Authenticate caller ─────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

  const { template, to, toName, from, fromName, replyTo, data } = payload as {
    template: string; to: string; toName?: string; from: string; fromName?: string; replyTo?: string; data: Record<string, string>;
  };

  if (!to || !from || !template) {
    return new Response(JSON.stringify({ error: "Missing required fields: to, from, template" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Only allow sending to the authenticated user's own email (prevents email spoofing/abuse)
  if (to.toLowerCase() !== (user.email || '').toLowerCase()) {
    return new Response(
      JSON.stringify({ error: "You can only send emails to your own address" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Rate limit per user ─────────────────────────────────────────────────────
  const rateKey = user.email || user.id || 'unknown';
  if (!checkRateLimit(rateKey)) {
    return new Response(
      JSON.stringify({ error: "Hourly email limit reached (10)." }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const subjects: Record<string, string> = {
    "welcome": "Welcome to APEX Coaching — your macros are ready",
    "upgrade-nudge": "Your free macros + one upgrade option",
    "payment-confirm": "Payment confirmed — your coaching plan is active",
    "checkin-reminder": "Reminder: weekly check-in due",
    "coach-note": "Message from your APEX Coach",
    "application-received": "Application received — we'll be in touch within 24h",
    "email-verify": "Verify your APEX account",
    "coach-message-alert": "New message from a client",
    "client-message-alert": "New message from your coach"
  };
  const subject = subjects[template] || `Message from ${fromName || "APEX Coaching"}`;
  const emailPayload: Record<string, unknown> = {
    from: fromName ? `${fromName} <${from}>` : from,
    to: toName ? [`${toName} <${to}>`] : [to],
    subject,
    html: `<p>${JSON.stringify(data)}</p>`
  };
  if (replyTo) emailPayload.reply_to = replyTo;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload)
    });
    const result = await res.json();
    return new Response(JSON.stringify(result), {
      status: res.ok ? 200 : res.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("send-email error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to send email" }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
