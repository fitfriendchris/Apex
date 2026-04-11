// supabase/functions/smart-onboard/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// AGENT 5 — SmartOnboard AI
// Conversational AI embedded in the sales page. Qualifies leads, answers
// questions about the program, and builds a personalized macro/plan preview
// to drive conversions. No auth required — this is a pre-login funnel agent.
//
// Deploy:
//   supabase functions deploy smart-onboard
//
// Secrets needed:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set ALLOWED_ORIGIN=https://apexcoaching.app
//
// Request body:
//   {
//     messages:  [{ role: "user"|"assistant", content: string }],
//     userData?: { name?, age?, sex?, weight?, goalWeight?, goal?, activity? }
//   }
//
// Response:
//   {
//     reply: string,
//     planPreview?: { calories, protein, carb, fat, phase, weeklyPace },
//     suggestedTier?: "ai_basic" | "core" | "elite" | "vip" | "diamond",
//     ctaLabel?: string,
//     readyToConvert: boolean
//   }
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://apexcoaching.app";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Rate limit: max 20 messages per session to prevent API abuse ──────────────
const SESSION_MSG_LIMIT = 20;

// ── In-memory rate limiter with bounded map size ──────────────────────────────
// Resets on cold start. Max 5,000 IPs tracked to prevent memory growth on
// long-running (warm) function instances.
const MAX_IP_ENTRIES = 5_000;
const ipCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // ── Evict expired entries to bound Map size ─────────────────────────────────
  // Only runs when we're near the limit to amortise the O(n) cost.
  if (ipCounts.size >= MAX_IP_ENTRIES) {
    for (const [key, val] of ipCounts) {
      if (now > val.resetAt) ipCounts.delete(key);
    }
    // If still at limit after eviction, reject the oldest entry (LRU approximation)
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
  if (record.count >= 30) return false; // 30 req/min per IP
  record.count++;
  return true;
}

const SYSTEM_PROMPT = `You are APEX, an elite physique coaching AI on the APEX Coaching sales page. 
Your purpose: have a genuine consultation conversation, understand the visitor's goals, and show them 
exactly what their transformation plan would look like — then guide them to the right plan.

PERSONALITY:
- Confident, direct, expert. Not salesy or pushy.
- You've helped hundreds of people transform. Speak from experience.
- Ask focused questions — one at a time. Don't interrogate.
- When you have enough data (name, goal, current/goal weight, sex, activity), compute their plan.

PLAN COMPUTATION (Mifflin-St Jeor + Harris Benedict):
For males: BMR = 10×weight_kg + 6.25×height_cm - 5×age + 5
For females: BMR = 10×weight_kg + 6.25×height_cm - 5×age - 161
TDEE = BMR × activity_multiplier (1.2 sedentary / 1.375 light / 1.55 moderate / 1.725 active / 1.9 very active)
Cut: TDEE - 400 to 500 kcal (never below 1400 for women / 1600 for men)
Bulk: TDEE + 200 to 300 kcal
Protein: body_weight_lbs × 1.0 (cut) or 0.9 (bulk), in grams
Fat: 25-30% of total calories, in grams
Carbs: remainder

TIER RECOMMENDATION LOGIC:
- Just wants AI tools, no coach: suggest ai_basic ($9.99/mo)
- Wants structure + accountability, doesn't need hand-holding: suggest core ($97/mo)
- Wants direct coaching access + custom plan: suggest elite ($297/mo)
- Ready to go all-in, wants the fastest possible transformation: suggest vip ($1,500)
- Elite athlete / serious competitor / CEO time-poor: suggest diamond ($5,000)

RESPONSE FORMAT — always return ONLY valid JSON:
{
  "reply": "string — your conversational response (no markdown, 1–4 sentences)",
  "planPreview": null | {
    "calories": number,
    "protein": number,
    "carb": number,
    "fat": number,
    "phase": "cut" | "bulk" | "recomp",
    "weeklyPace": "string",
    "tdee": number
  },
  "suggestedTier": null | "ai_basic" | "core" | "elite" | "vip" | "diamond",
  "ctaLabel": null | "string — e.g. 'Start Your Free Account' or 'See Elite Plan →'",
  "readyToConvert": boolean,
  "followUpQuestion": null | "string — next question to gather missing data"
}

CONVERSATION FLOW:
1. Warm greeting — ask what brings them here
2. Collect: name → goal → current weight → goal weight → sex → activity level
3. Once you have the data: reveal their exact macro plan (compute it)
4. Explain what the plan means for them specifically
5. Recommend the right tier based on what they want
6. When readyToConvert = true, set an appropriate ctaLabel

NEVER:
- Mention competitor products
- Give medical advice
- Make guarantees beyond realistic pace (0.5–1.5 lbs/week fat loss)
- Be vague about numbers — always show the actual calculated values`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  // ── IP rate limit ─────────────────────────────────────────────────────────────
  const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(clientIP)) {
    return jsonError("Too many requests — slow down", 429);
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return jsonError("ANTHROPIC_API_KEY not configured", 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonError("Invalid JSON", 400); }

  const { messages, userData } = body as {
    messages: { role: "user" | "assistant"; content: string }[];
    userData?: {
      name?: string; age?: number; sex?: string;
      weight?: number; goalWeight?: number; height?: number;
      goal?: string; activity?: string;
    };
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("messages array is required", 400);
  }

  // ── Session length guard ──────────────────────────────────────────────────────
  if (messages.length > SESSION_MSG_LIMIT * 2) {
    return jsonError("Session limit reached — please register to continue", 429);
  }

  // ── Validate and sanitise message structure ───────────────────────────────────
  const validMessages = messages
    .filter(m => m.role && m.content && ["user", "assistant"].includes(m.role))
    .slice(-20) // Keep last 20 turns max for context window efficiency
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));

  if (validMessages.length === 0 || validMessages[validMessages.length - 1].role !== "user") {
    return jsonError("Last message must be from the user", 400);
  }

  // ── Inject known userData into system context ─────────────────────────────────
  const userContext = userData && Object.keys(userData).some(k => (userData as Record<string, unknown>)[k])
    ? `\nKnown visitor data: ${JSON.stringify(userData)}\nUse this to personalise — don't re-ask for data you already have.`
    : "";

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",  // Haiku: fast for real-time chat
        max_tokens: 1024,
        system: SYSTEM_PROMPT + userContext,
        messages: validMessages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Anthropic error:", errText);
      return jsonError("AI response failed", 502);
    }

    const aiData = await res.json();
    const rawText = aiData.content?.[0]?.text ?? "";

    let result: {
      reply: string;
      planPreview?: unknown;
      suggestedTier?: string;
      ctaLabel?: string;
      readyToConvert: boolean;
      followUpQuestion?: string;
    };

    try {
      const cleaned = rawText.replace(/```json\n?|```\n?/g, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      // Graceful fallback — return raw text as a reply if JSON parse fails
      console.warn("SmartOnboard JSON parse failed — using fallback:", rawText.slice(0, 200));
      result = {
        reply: rawText.replace(/[{}"]/g, "").slice(0, 300) ||
               "I'm here to help you find the right plan. What's your main goal right now?",
        readyToConvert: false,
      };
    }

    // ── Sanitise output ────────────────────────────────────────────────────────
    const validTiers = ["ai_basic", "core", "elite", "vip", "diamond"];
    const sanitized = {
      reply:            String(result.reply ?? "").slice(0, 600),
      planPreview:      result.planPreview ?? null,
      suggestedTier:    validTiers.includes(result.suggestedTier ?? "") ? result.suggestedTier : null,
      ctaLabel:         result.ctaLabel ? String(result.ctaLabel).slice(0, 60) : null,
      readyToConvert:   result.readyToConvert === true,
      followUpQuestion: result.followUpQuestion ? String(result.followUpQuestion).slice(0, 150) : null,
    };

    return new Response(JSON.stringify(sanitized), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("smart-onboard error:", err);
    return jsonError("Internal server error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
