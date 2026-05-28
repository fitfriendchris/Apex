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

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://fitfriendchris.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    // Check if coach already exists in auth.users
    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;

    const coachUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === email
    );

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

    // Generate a session (access_token + refresh_token)
    const { data: signInData, error: signInError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: ALLOWED_ORIGIN },
    });

    // Actually, generateLink doesn't give us tokens. We need to use signInWithPassword
    // with the service_role client... but that won't work either.
    // The correct approach: use createUser + then sign in via the public API
    // Since we just set/created the user with a known password, we can sign in
    // using the regular anon client.

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
