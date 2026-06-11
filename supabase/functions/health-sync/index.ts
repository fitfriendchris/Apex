// health-sync — JWT-gated batch ingest for HealthKit / wearable data.
// POST { metrics: [{ metric_date, source?, hrv_ms?, resting_hr?, sleep_hours?,
//                    sleep_quality?, steps?, active_kcal?, vo2max?, raw? }] }
// Computes a 0-100 readiness score per row and upserts on (user_id, metric_date, source).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

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

const NUM = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Simple transparent readiness model: HRV 40%, sleep 35%, resting HR 25%.
// Baselines are personal medians over the trailing 14 days when available.
function readiness(row: Record<string, number | null>, base: { hrv: number | null; rhr: number | null }) {
  let score = 0, weight = 0;
  if (row.hrv_ms != null) {
    const b = base.hrv ?? row.hrv_ms;
    score += clamp(50 + ((row.hrv_ms - b) / b) * 100, 0, 100) * 0.40; weight += 0.40;
  }
  if (row.sleep_hours != null) {
    score += clamp((row.sleep_hours / 8) * 100, 0, 100) * 0.35; weight += 0.35;
  }
  if (row.resting_hr != null) {
    const b = base.rhr ?? row.resting_hr;
    score += clamp(50 - ((row.resting_hr - b) / b) * 150, 0, 100) * 0.25; weight += 0.25;
  }
  return weight > 0 ? Math.round(score / weight) : null;
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supa.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...cors, "content-type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const metrics = Array.isArray(body?.metrics) ? body.metrics.slice(0, 60) : [];
    if (metrics.length === 0) {
      return new Response(JSON.stringify({ error: "metrics[] required" }), {
        status: 400, headers: { ...cors, "content-type": "application/json" },
      });
    }

    // Personal 14-day baselines for readiness scoring (RLS scopes to this user).
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const { data: hist } = await supa.from("health_metrics")
      .select("hrv_ms, resting_hr").gte("metric_date", since).limit(60);
    const median = (a: number[]) => a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
    const base = {
      hrv: median((hist ?? []).map((r) => Number(r.hrv_ms)).filter((n) => n > 0)),
      rhr: median((hist ?? []).map((r) => Number(r.resting_hr)).filter((n) => n > 0)),
    };

    const rows = metrics.map((m: Record<string, unknown>) => {
      const row = {
        user_id: user.id,
        metric_date: String(m.metric_date ?? "").slice(0, 10),
        source: typeof m.source === "string" && m.source ? m.source.slice(0, 32) : "healthkit",
        hrv_ms: NUM(m.hrv_ms), resting_hr: NUM(m.resting_hr),
        sleep_hours: NUM(m.sleep_hours), sleep_quality: NUM(m.sleep_quality),
        steps: NUM(m.steps), active_kcal: NUM(m.active_kcal), vo2max: NUM(m.vo2max),
        raw: typeof m.raw === "object" && m.raw ? m.raw : {},
        readiness: null as number | null,
      };
      row.readiness = readiness(row as never, base);
      return row;
    }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.metric_date));

    const { error } = await supa.from("health_metrics")
      .upsert(rows, { onConflict: "user_id,metric_date,source" });
    if (error) throw error;

    const latest = rows[rows.length - 1];
    return new Response(JSON.stringify({ ok: true, synced: rows.length, readiness: latest?.readiness ?? null }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...cors, "content-type": "application/json" },
    });
  }
});
