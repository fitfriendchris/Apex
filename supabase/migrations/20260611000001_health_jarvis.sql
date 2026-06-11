-- 20260611000001_health_jarvis.sql
-- Sprint 1: wearable intelligence + Jarvis command center sync

-- ── Health metrics (HealthKit / wearable ingest) ──────────────────
CREATE TABLE IF NOT EXISTS health_metrics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  source      text NOT NULL DEFAULT 'healthkit',   -- healthkit | whoop | garmin | manual
  hrv_ms      numeric,        -- SDNN ms
  resting_hr  numeric,        -- bpm
  sleep_hours numeric,
  sleep_quality numeric,      -- 0-100 if provided
  steps       integer,
  active_kcal numeric,
  vo2max      numeric,
  readiness   numeric,        -- computed 0-100 (server-side)
  raw         jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, metric_date, source)
);
CREATE INDEX IF NOT EXISTS idx_health_metrics_user_date ON health_metrics (user_id, metric_date DESC);

ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY health_metrics_select_own ON health_metrics
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY health_metrics_insert_own ON health_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY health_metrics_update_own ON health_metrics
  FOR UPDATE USING (auth.uid() = user_id);
-- Service role bypasses RLS (Jarvis bridge + edge functions read for analysis).

-- ── Jarvis command queue (Jarvis → APEX actions) ──────────────────
CREATE TABLE IF NOT EXISTS jarvis_commands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command     text NOT NULL,                -- e.g. broadcast_message, flag_client, generate_report
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'pending',  -- pending | running | done | error
  result      jsonb,
  created_by  text NOT NULL DEFAULT 'jarvis',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jarvis_commands_status ON jarvis_commands (status, created_at);

-- ── Jarvis event stream (APEX → Jarvis telemetry) ─────────────────
CREATE TABLE IF NOT EXISTS jarvis_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type  text NOT NULL,                -- signup, checkin_missed, churn_risk, pr_hit, payment
  user_id     uuid,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  consumed    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jarvis_events_unconsumed ON jarvis_events (consumed, created_at);

-- Lock both Jarvis tables to service role only (no client access).
ALTER TABLE jarvis_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE jarvis_events  ENABLE ROW LEVEL SECURITY;
-- No policies created on purpose: anon/authenticated get nothing; service role bypasses RLS.

-- ── Event triggers: feed Jarvis automatically ─────────────────────
CREATE OR REPLACE FUNCTION notify_jarvis_signup() RETURNS trigger AS $$
BEGIN
  INSERT INTO jarvis_events (event_type, user_id, data)
  VALUES ('signup', NEW.id, jsonb_build_object('email', NEW.email, 'tier', COALESCE(NEW.tier,'free')));
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_jarvis_signup ON users;
CREATE TRIGGER trg_jarvis_signup AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION notify_jarvis_signup();
