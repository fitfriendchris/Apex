-- ================================================================
--  APEX COACHING — MISSING TABLES (causing 404 errors)
--  Run in Supabase SQL Editor
-- ================================================================

CREATE TABLE IF NOT EXISTS user_gamification (
  user_email    text PRIMARY KEY,
  total_xp      int DEFAULT 0,
  level         int DEFAULT 1,
  streak_days   int DEFAULT 0,
  badges        jsonb DEFAULT '[]',
  last_activity date
);
ALTER TABLE user_gamification ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "xp_self" ON user_gamification;
CREATE POLICY "xp_self" ON user_gamification FOR ALL
  USING (user_email = current_setting('request.jwt.claims',true)::json->>'email');

CREATE TABLE IF NOT EXISTS weight_history (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email  text NOT NULL,
  log_date    date NOT NULL,
  weight_lbs  numeric,
  UNIQUE(user_email, log_date)
);
ALTER TABLE weight_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "weight_self" ON weight_history;
CREATE POLICY "weight_self" ON weight_history FOR ALL
  USING (user_email = current_setting('request.jwt.claims',true)::json->>'email');

CREATE TABLE IF NOT EXISTS personal_records (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email  text NOT NULL,
  lift_name   text NOT NULL,
  weight_lbs  numeric,
  reps        int,
  pr_date     date,
  UNIQUE(user_email, lift_name)
);
ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pr_self" ON personal_records;
CREATE POLICY "pr_self" ON personal_records FOR ALL
  USING (user_email = current_setting('request.jwt.claims',true)::json->>'email');

CREATE TABLE IF NOT EXISTS body_measurements (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email     text NOT NULL,
  site_name      text NOT NULL,
  value_inches   numeric,
  measured_date  date,
  UNIQUE(user_email, site_name, measured_date)
);
ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meas_self" ON body_measurements;
CREATE POLICY "meas_self" ON body_measurements FOR ALL
  USING (user_email = current_setting('request.jwt.claims',true)::json->>'email');

-- Verify
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('user_gamification','weight_history','personal_records','body_measurements')
ORDER BY tablename;
