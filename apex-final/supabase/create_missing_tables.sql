-- ================================================================
--  APEX COACHING — MISSING TABLES
--  Run this in Supabase SQL Editor if food logging isn't saving
--  dashboard.supabase.com → your project → SQL Editor → New query
-- ================================================================

-- Daily food + habit logs
CREATE TABLE IF NOT EXISTS daily_logs (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email   text NOT NULL,
  log_date     date NOT NULL,
  foods        jsonb DEFAULT '[]',
  checks       jsonb DEFAULT '{}',
  water        int  DEFAULT 0,
  fast_start   text DEFAULT '20:00',
  fast_end     text DEFAULT '12:00',
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE(user_email, log_date)
);

ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "logs_self_all"   ON daily_logs;
DROP POLICY IF EXISTS "coach_read_logs" ON daily_logs;

CREATE POLICY "logs_self_all" ON daily_logs
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');

CREATE POLICY "coach_read_logs" ON daily_logs
  FOR SELECT
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'coach');

-- Workout logs (sets/reps per exercise)
CREATE TABLE IF NOT EXISTS workout_logs (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email   text NOT NULL,
  log_date     date NOT NULL,
  day_name     text,
  completed    boolean DEFAULT false,
  finished_at  timestamptz,
  exercises    jsonb DEFAULT '{}',
  created_at   timestamptz DEFAULT now(),
  UNIQUE(user_email, log_date)
);

ALTER TABLE workout_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wlogs_self_all"   ON workout_logs;
DROP POLICY IF EXISTS "wlogs_coach_read" ON workout_logs;

CREATE POLICY "wlogs_self_all" ON workout_logs
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');

CREATE POLICY "wlogs_coach_read" ON workout_logs
  FOR SELECT
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'coach');

-- AI usage tracking (enforces daily limits)
CREATE TABLE IF NOT EXISTS daily_ai_usage (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email  text NOT NULL,
  usage_date  date NOT NULL,
  scan_count  int  DEFAULT 0,
  UNIQUE(user_email, usage_date)
);

ALTER TABLE daily_ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_usage_self" ON daily_ai_usage;

CREATE POLICY "ai_usage_self" ON daily_ai_usage
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');

-- ── VERIFY ────────────────────────────────────────────────────
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('daily_logs', 'workout_logs', 'daily_ai_usage')
ORDER BY tablename;
