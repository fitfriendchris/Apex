/**
 * APEX COACHING — AI Food Analyzer
 * Supabase Edge Function (Deno runtime)
 * ======================================
 * Proxies requests to Anthropic so clients never need an API key.
 *
 * DEPLOY (one-time setup):
 *   1. Install Supabase CLI:  npm install -g supabase
 *   2. Login:                 supabase login
 *   3. Link project:          supabase link --project-ref yiqilesbvthmwdrtlhgm
 *   4. Set the secret:        supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   5. Deploy this function:  supabase functions deploy analyze-food
 *
 * The function URL will be:
 *   https://yiqilesbvthmwdrtlhgm.supabase.co/functions/v1/analyze-food
 *
 * Rate limit: 30 requests / hour per user email (in-memory, per instance).
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// ── In-memory rate limiter ────────────────────────────────────────────────────
const rateLimiter = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT = 30;
const WINDOW_MS  = 60 * 60 * 1000; // 1 hour

function checkRateLimit(email: string): boolean {
  const now  = Date.now();
  const key  = email || 'anonymous';
  const entry = rateLimiter.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimiter.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── System prompts ────────────────────────────────────────────────────────────
const SCAN_SYSTEM = `You are an elite sports nutritionist. Analyze the food image precisely.
Return ONLY valid JSON — no markdown, no preamble. Structure:
{
  "name":"string","portion":"string","calories":number,"protein":number,
  "carbs":number,"fats":number,"fiber":number,"sugar":number,
  "micros":{
    "vitaminA":{"amount":number,"unit":"mcg","dv":number},
    "vitaminC":{"amount":number,"unit":"mg","dv":number},
    "vitaminD":{"amount":number,"unit":"IU","dv":number},
    "vitaminE":{"amount":number,"unit":"mg","dv":number},
    "calcium":{"amount":number,"unit":"mg","dv":number},
    "iron":{"amount":number,"unit":"mg","dv":number},
    "magnesium":{"amount":number,"unit":"mg","dv":number},
    "zinc":{"amount":number,"unit":"mg","dv":number},
    "potassium":{"amount":number,"unit":"mg","dv":number},
    "sodium":{"amount":number,"unit":"mg","dv":number},
    "omega3":{"amount":number,"unit":"g","dv":number},
    "folate":{"amount":number,"unit":"mcg","dv":number},
    "b12":{"amount":number,"unit":"mcg","dv":number},
    "selenium":{"amount":number,"unit":"mcg","dv":number}
  },
  "insights":["performance benefit","nutrient gap","one improvement"],
  "category":"breakfast|lunch|dinner|snack|pre-workout|post-workout"
}`;

function buildTextSystem(ctx: Record<string, unknown>): string {
  return `You are an elite sports nutritionist. The user describes a meal in plain text.
Return ONLY valid JSON — no markdown, no explanation.
{
  "name":"string","portion":"string","calories":number,"protein":number,
  "carbs":number,"fats":number,"fiber":number,"sugar":number,
  "items":[{"name":"string","calories":number,"protein":number,"carbs":number,"fats":number}],
  "micros":{
    "vitaminA":{"amount":number,"unit":"mcg","dv":number},
    "vitaminC":{"amount":number,"unit":"mg","dv":number},
    "vitaminD":{"amount":number,"unit":"IU","dv":number},
    "vitaminE":{"amount":number,"unit":"mg","dv":number},
    "calcium":{"amount":number,"unit":"mg","dv":number},
    "iron":{"amount":number,"unit":"mg","dv":number},
    "magnesium":{"amount":number,"unit":"mg","dv":number},
    "zinc":{"amount":number,"unit":"mg","dv":number},
    "potassium":{"amount":number,"unit":"mg","dv":number},
    "sodium":{"amount":number,"unit":"mg","dv":number},
    "omega3":{"amount":number,"unit":"g","dv":number},
    "folate":{"amount":number,"unit":"mcg","dv":number},
    "b12":{"amount":number,"unit":"mcg","dv":number},
    "selenium":{"amount":number,"unit":"mcg","dv":number}
  },
  "insights":["performance benefit","what it lacks","one improvement"],
  "rating":number
}
User stats: weight=${ctx.weight ?? '?'}lbs, goal=${ctx.goal ?? '?'}, phase=${ctx.phase ?? '?'}, daily targets: ${ctx.calories ?? '?'}kcal / ${ctx.protein ?? '?'}g protein.`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Anthropic key from Supabase secrets (set once via CLI)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('[analyze-food] ANTHROPIC_API_KEY secret not set');
    return new Response(
      JSON.stringify({ error: 'AI service not configured. Run: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...' }),
      { status: 503, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { type, userEmail } = body as { type: string; userEmail?: string };

  // Rate limit
  if (!checkRateLimit(userEmail ?? 'anonymous')) {
    return new Response(
      JSON.stringify({ error: 'Rate limit reached (30 analyses/hour). Try again later.' }),
      { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // Build the Anthropic request body
  let anthropicBody: Record<string, unknown>;
  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

  if (type === 'scan') {
    const { image } = body as { image?: { base64?: string; mediaType?: string } };
    if (!image?.base64 || !image?.mediaType) {
      return new Response(JSON.stringify({ error: 'Missing image data' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    if (!ALLOWED_TYPES.includes(image.mediaType)) {
      return new Response(JSON.stringify({ error: 'Unsupported image type' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1600,
      system: SCAN_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
          { type: 'text', text: 'Analyze this food precisely. Estimate portion sizes from visual cues. Return only the JSON object.' },
        ],
      }],
    };

  } else if (type === 'text') {
    const { meal, userContext } = body as { meal?: string; userContext?: Record<string, unknown> };
    if (!meal || typeof meal !== 'string' || !meal.trim()) {
      return new Response(JSON.stringify({ error: 'Missing meal description' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1800,
      system: buildTextSystem(userContext ?? {}),
      messages: [{ role: 'user', content: `Calculate the macros for: ${meal.trim().slice(0, 2000)}` }],
    };

  } else {
    return new Response(JSON.stringify({ error: 'type must be "scan" or "text"' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Call Anthropic
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await response.json() as { error?: { message?: string }; content?: Array<{ text?: string }> };

    if (data.error) {
      console.error('[analyze-food] Anthropic error:', data.error);
      return new Response(
        JSON.stringify({ error: data.error.message ?? 'Anthropic API error' }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const raw = (data.content ?? []).map(c => c.text ?? '').join('');
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let food: unknown;
    try {
      food = JSON.parse(cleaned);
    } catch {
      console.error('[analyze-food] Failed to parse AI response:', raw.slice(0, 300));
      return new Response(
        JSON.stringify({ error: 'AI returned invalid data. Try a clearer photo or description.' }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ ok: true, food }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[analyze-food] Fetch error:', msg);
    return new Response(
      JSON.stringify({ error: 'Failed to reach AI service. Check your connection.' }),
      { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }
});
