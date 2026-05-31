// supabase/functions/coach-login/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Secure coach login using Supabase Admin API (service_role key).
//
// Problem: doCoachLogin() was using signInWithPassword with the coach portal
// password as the auth password. This fails when email confirmation is enabled
// (default) because signUp() doesn't return a session until confirmation.
//
// Solution: Server-side admin login. The edge function:
//   1. Verifies the coach password against COACH_SECRET
//   2. Looks up the coach in auth.users by email
//   3. If exists → generates a new session via admin auth
//   4. If missing → creates a confirmed user via admin auth, then generates session
//   5. Returns access_token and refresh_token to the frontend
//
// Deploy:
//   supabase functions deploy coach-login
//
// Secrets needed:
//   supabase secrets set COACH_SECRET=your_coach_password
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...
//   supabase secrets set ALLOWED_ORIGIN=https://fitfriendchris.github.io
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "https://fitfriendchris.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);
function buildCors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

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

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Rate limit by IP ────────────────────────────────────────────────────────
  const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (!clientIP || !checkRateLimit(clientIP)) {
    return new Response(JSON.stringify({ error: "Too many attempts — slow down" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Parse and validate request ──────────────────────────────────────────────
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const email = String(body.email ?? "").toLowerCase().trim();
  const password = String(body.password ?? "");
  const coachSecret = Deno.env.get("COACH_SECRET") ?? "";

  if (!email || !password || !coachSecret) {
    return new Response(JSON.stringify({ error: "Missing email or password" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify coach password
  if (password !== coachSecret) {
    return new Response(JSON.stringify({ error: "Invalid credentials" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Admin API client (service_role) ─────────────────────────────────────────
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    // Check if coach already exists in auth.users.
    // listUsers() is paginated (50/page by default); searching only the first
    // page silently breaks coach login once the user base grows past 50 — the
    // coach wouldn't be found, createUser would fail on the duplicate email, and
    // login would 500. Page through until we find the coach (or run out).
    let coachUser: { id: string; email?: string } | undefined;
    const PER_PAGE = 1000;
    for (let page = 1; page <= 100; page++) {
      const { data: pageData, error: listError } =
        await supabaseAdmin.auth.admin.listUsers({ page, perPage: PER_PAGE });
      if (listError) throw listError;
      const users = pageData?.users ?? [];
      coachUser = users.find((u) => u.email?.toLowerCase() === email);
      if (coachUser || users.length < PER_PAGE) break; // found, or last page
    }

    let userId: string;

    if (coachUser) {
      userId = coachUser.id;
      // Update password to ensure it matches current COACH_SECRET
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { password }
      );
      if (updateError) throw updateError;
    } else {
      // Create confirmed coach account
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // skip confirmation — this is a backend account
        user_metadata: { role: "coach" },
      });
      if (createError || !createData?.user) {
        throw createError ?? new Error("Failed to create coach user");
      }
      userId = createData.user.id;
    }

    // Mint a session. We just created/updated the coach with a known password,
    // so sign in through the public (anon) client to get access + refresh tokens.
    const supabasePublic = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const { data: authData, error: authError } = await supabasePublic.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.session) {
      throw authError ?? new Error("Session creation failed");
    }

    return new Response(
      JSON.stringify({
        success: true,
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_at: authData.session.expires_at,
        user: { id: authData.user.id, email: authData.user.email },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
      }
    );

  } catch (err) {
    console.error("coach-login error:", err);
    return new Response(
      JSON.stringify({ error: "Authentication service error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
