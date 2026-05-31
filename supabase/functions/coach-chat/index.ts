import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "https://fitfriendchris.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);
function buildCors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Authenticate caller ─────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const coachToken = req.headers.get("X-Coach-Token") ?? "";
  const isCoach = coachToken.length > 8 && coachToken === (Deno.env.get("COACH_SECRET") ?? "");

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

  if ((!user && !isCoach) || (authError && !isCoach)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { userEmail, message, history, userContext } = await req.json();
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("Anthropic key not configured");

    // Rate limit: 20 messages per session per day per user
    if (user?.email) {
      const today = new Date().toISOString().split("T")[0];
      try {
        const { data: usageRow } = await supabaseClient
          .from("daily_ai_usage")
          .select("scan_count")
          .eq("user_email", user.email)
          .eq("usage_date", today)
          .single();
        const calls = (usageRow?.scan_count ?? 0) as number;
        if (calls >= 20) {
          return new Response(
            JSON.stringify({ error: "Daily chat limit reached (20). Upgrade for unlimited access." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        await supabaseClient.rpc("increment_ai_usage", { p_email: user.email, p_date: today });
      } catch {
        // Fail-closed: if usage tracking fails, deny the request
        return new Response(
          JSON.stringify({ error: "Usage tracking unavailable. Please try again later." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const system = `You are an elite physique coaching AI assistant for APEX Coaching. You have access to this client's data and speak directly to them.

CLIENT PROFILE:
- Name: ${userContext?.name ?? "Client"}
- Goal: ${userContext?.goal ?? "—"} (${userContext?.phase ?? "—"})
- Current weight: ${userContext?.weight ?? "—"}lbs → Goal: ${userContext?.goalWeight ?? "—"}lbs (${userContext?.weightToGoal ?? "—"}lbs to go)
- Daily targets: ${userContext?.calories ?? "—"} cal | ${userContext?.protein ?? "—"}g protein | ${userContext?.carbs ?? "—"}g carbs | ${userContext?.fat ?? "—"}g fat
- Program: ${userContext?.program ?? "—"}
- Today's workout: ${userContext?.todayWorkout ?? "—"}

THIS WEEK'S DATA:
- Compliance: ${userContext?.weekCompliance ?? "—"}% (checklist completion)
- Avg calories logged: ${userContext?.avgCals ?? "—"} kcal/day
- Protein avg: ${userContext?.avgProtein ?? "—"}g/day
- Workout sessions: ${userContext?.workoutSessions ?? "—"} this week
- Last check-in: ${userContext?.lastCheckIn || 'none submitted'}

COACHING STYLE:
- Be direct, data-driven, and motivating
- Reference their specific numbers when relevant
- Give actionable advice, not generic tips
- Keep responses concise (2-4 sentences max unless explaining something complex)
- You are their coach — speak with authority and care
- If they ask about their specific macros, workouts, or progress, use their actual data above`;

    const messages = [
      ...(history || []).slice(-10).map((m: any) => ({
        role: m.role === 'assistant' || m.role === 'coach' ? 'assistant' : 'user',
        content: m.content
      })),
      { role: "user", content: message }
    ];

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system,
        messages,
      }),
    });

    const data = await res.json();
    if (data.error) {
      console.error("Anthropic API error:", data.error);
      return new Response(
        JSON.stringify({ error: "AI service temporarily unavailable" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const reply = data.content?.[0]?.text || "I couldn't generate a response. Please try again.";

    return new Response(JSON.stringify({ ok: true, reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("coach-chat error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
