-- ================================================================
--  APEX COACHING — SUPABASE ROW LEVEL SECURITY (Production)
--  Run this entire script in the Supabase SQL Editor:
--  dashboard.supabase.com → your project → SQL Editor → New query
--
--  CRITICAL: Run this before scaling to real users.
--  The anon key is exposed in the browser. Without RLS any
--  visitor can read, modify, or delete all user data.
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- COACHES TABLE
-- ────────────────────────────────────────────────────────────────
-- Coaches are identified by email in this table. RLS policies
-- use it instead of JWT role claims (which Supabase Auth doesn't
-- populate by default).
CREATE TABLE IF NOT EXISTS coaches (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email      text UNIQUE NOT NULL,
  name       text,
  created_at timestamptz DEFAULT now()
);

-- Insert default coach from APP_CONFIG (update email if needed)
INSERT INTO coaches (email, name)
VALUES ('fitfriendchris@gmail.com', 'Chris')
ON CONFLICT (email) DO NOTHING;


-- ════════════════════════════════════════════════════════════════
-- 1. USERS TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Drop any legacy wide-open policies
DROP POLICY IF EXISTS "allow_all" ON users;

-- Users can read their own row
DROP POLICY IF EXISTS "users_self_read" ON users;
CREATE POLICY "users_self_read" ON users
  FOR SELECT
  USING (email = current_setting('request.jwt.claims', true)::json->>'email');

-- Users can update their own row
DROP POLICY IF EXISTS "users_self_update" ON users;
CREATE POLICY "users_self_update" ON users
  FOR UPDATE
  USING (email = current_setting('request.jwt.claims', true)::json->>'email');

-- Anyone can insert (new registration)
DROP POLICY IF EXISTS "users_insert" ON users;
CREATE POLICY "users_insert" ON users
  FOR INSERT
  WITH CHECK (true);

-- Coach can read all users (identified via coaches table)
DROP POLICY IF EXISTS "coach_read_all_users" ON users;
CREATE POLICY "coach_read_all_users" ON users
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));


-- ════════════════════════════════════════════════════════════════
-- 2. DAILY_LOGS TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON daily_logs;

-- Users own their logs
DROP POLICY IF EXISTS "logs_self_all" ON daily_logs;
CREATE POLICY "logs_self_all" ON daily_logs
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');

-- Coach can read all logs (for dashboard)
DROP POLICY IF EXISTS "coach_read_logs" ON daily_logs;
CREATE POLICY "coach_read_logs" ON daily_logs
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));


-- ════════════════════════════════════════════════════════════════
-- 3. WORKOUT_OVERRIDES TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE workout_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON workout_overrides;

-- Clients can read their overrides; coach can read/write all
DROP POLICY IF EXISTS "overrides_self_read" ON workout_overrides;
CREATE POLICY "overrides_self_read" ON workout_overrides
  FOR SELECT
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');

DROP POLICY IF EXISTS "overrides_coach_all" ON workout_overrides;
CREATE POLICY "overrides_coach_all" ON workout_overrides
  FOR ALL
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));


-- ════════════════════════════════════════════════════════════════
-- 4. COACH_NOTES TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE coach_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON coach_notes;

-- Clients can read their own coach notes
DROP POLICY IF EXISTS "cnotes_self_read" ON coach_notes;
CREATE POLICY "cnotes_self_read" ON coach_notes
  FOR SELECT
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');

-- Coach can read and write all coach notes
DROP POLICY IF EXISTS "cnotes_coach_all" ON coach_notes;
CREATE POLICY "cnotes_coach_all" ON coach_notes
  FOR ALL
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));


-- ════════════════════════════════════════════════════════════════
-- 5. SESSIONS TABLE (booking)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON sessions;

-- Clients can read/insert their own sessions
DROP POLICY IF EXISTS "sessions_self_read" ON sessions;
CREATE POLICY "sessions_self_read" ON sessions
  FOR SELECT
  USING (client_email = current_setting('request.jwt.claims', true)::json->>'email');

DROP POLICY IF EXISTS "sessions_self_insert" ON sessions;
CREATE POLICY "sessions_self_insert" ON sessions
  FOR INSERT
  WITH CHECK (client_email = current_setting('request.jwt.claims', true)::json->>'email');

-- Coach can read and update all sessions
DROP POLICY IF EXISTS "sessions_coach_all" ON sessions;
CREATE POLICY "sessions_coach_all" ON sessions
  FOR ALL
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));


-- ════════════════════════════════════════════════════════════════
-- 6. AVAILABILITY TABLE (coach schedule)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON availability;

-- Anyone authenticated can read availability (to show booking calendar)
DROP POLICY IF EXISTS "avail_read" ON availability;
CREATE POLICY "avail_read" ON availability
  FOR SELECT
  USING (true);

-- Only coach can modify availability
DROP POLICY IF EXISTS "avail_coach_write" ON availability;
CREATE POLICY "avail_coach_write" ON availability
  FOR ALL
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));


-- ════════════════════════════════════════════════════════════════
-- 7. BLOCKED_DATES TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE blocked_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON blocked_dates;

-- Anyone authenticated can read blocked dates (booking UI needs this)
DROP POLICY IF EXISTS "blocked_read" ON blocked_dates;
CREATE POLICY "blocked_read" ON blocked_dates
  FOR SELECT
  USING (true);

-- Only coach can modify
DROP POLICY IF EXISTS "blocked_coach_write" ON blocked_dates;
CREATE POLICY "blocked_coach_write" ON blocked_dates
  FOR ALL
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));


-- ════════════════════════════════════════════════════════════════
-- 8. MESSAGES TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON messages;

-- Participants (client or coach) can access messages in their conversation
-- conversation_id format: "clientEmail:coachId"
DROP POLICY IF EXISTS "messages_participants" ON messages;
CREATE POLICY "messages_participants" ON messages
  FOR ALL
  USING (
    conversation_id LIKE (current_setting('request.jwt.claims', true)::json->>'email') || '%'
    OR conversation_id LIKE '%:' || (current_setting('request.jwt.claims', true)::json->>'email')
    OR EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email')
  );


-- ════════════════════════════════════════════════════════════════
-- 9. CONTACT_REQUESTS TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON contact_requests;

-- Anyone can submit a contact request
DROP POLICY IF EXISTS "contact_insert" ON contact_requests;
CREATE POLICY "contact_insert" ON contact_requests
  FOR INSERT
  WITH CHECK (true);

-- Users can see their own submissions
DROP POLICY IF EXISTS "contact_self_read" ON contact_requests;
CREATE POLICY "contact_self_read" ON contact_requests
  FOR SELECT
  USING (from_email = current_setting('request.jwt.claims', true)::json->>'email');

-- Coach can read all contact requests
DROP POLICY IF EXISTS "contact_coach_read" ON contact_requests;
CREATE POLICY "contact_coach_read" ON contact_requests
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));


-- ════════════════════════════════════════════════════════════════
-- 10. WORKOUT_LOGS TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE workout_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON workout_logs;

DROP POLICY IF EXISTS "wlogs_self_all" ON workout_logs;
CREATE POLICY "wlogs_self_all" ON workout_logs
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');

DROP POLICY IF EXISTS "wlogs_coach_read" ON workout_logs;
CREATE POLICY "wlogs_coach_read" ON workout_logs
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));


-- ════════════════════════════════════════════════════════════════
-- 11. DAILY_AI_USAGE TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE daily_ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all" ON daily_ai_usage;

DROP POLICY IF EXISTS "ai_usage_self" ON daily_ai_usage;
CREATE POLICY "ai_usage_self" ON daily_ai_usage
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');


-- ════════════════════════════════════════════════════════════════
-- 12. CREATE MISSING TABLES (if they don't exist yet)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS weight_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  log_date date NOT NULL,
  weight_lbs numeric(5,1) NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_email, log_date)
);

CREATE TABLE IF NOT EXISTS personal_records (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  lift_name text NOT NULL,
  weight_lbs numeric(6,1),
  reps int,
  pr_date date,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_email, lift_name)
);

CREATE TABLE IF NOT EXISTS body_measurements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  site_name text NOT NULL,
  value_inches numeric(5,2),
  measured_date date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_gamification (
  user_email text PRIMARY KEY,
  total_xp int DEFAULT 0,
  level int DEFAULT 1,
  streak_days int DEFAULT 0,
  badges jsonb DEFAULT '[]',
  last_activity date,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_progress (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  course_id text NOT NULL,
  progress_data jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_email, course_id)
);

CREATE TABLE IF NOT EXISTS check_ins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  date date NOT NULL,
  week int,
  energy int,
  sleep int,
  stress int,
  perf int,
  weight numeric(6,1),
  win text,
  challenge text,
  coach_q text,
  photo_urls jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_email, date)
);


-- ════════════════════════════════════════════════════════════════
-- 13. ADDITIONAL TABLES — RLS POLICIES
-- ════════════════════════════════════════════════════════════════

-- weight_history
ALTER TABLE weight_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON weight_history;
DROP POLICY IF EXISTS "wh_self_all" ON weight_history;
CREATE POLICY "wh_self_all" ON weight_history
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');
DROP POLICY IF EXISTS "wh_coach_read" ON weight_history;
CREATE POLICY "wh_coach_read" ON weight_history
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));

-- personal_records
ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON personal_records;
DROP POLICY IF EXISTS "pr_self_all" ON personal_records;
CREATE POLICY "pr_self_all" ON personal_records
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');
DROP POLICY IF EXISTS "pr_coach_read" ON personal_records;
CREATE POLICY "pr_coach_read" ON personal_records
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));

-- body_measurements
ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON body_measurements;
DROP POLICY IF EXISTS "bm_self_all" ON body_measurements;
CREATE POLICY "bm_self_all" ON body_measurements
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');
DROP POLICY IF EXISTS "bm_coach_read" ON body_measurements;
CREATE POLICY "bm_coach_read" ON body_measurements
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));

-- user_gamification
ALTER TABLE user_gamification ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON user_gamification;
DROP POLICY IF EXISTS "ug_self_all" ON user_gamification;
CREATE POLICY "ug_self_all" ON user_gamification
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');
DROP POLICY IF EXISTS "ug_coach_read" ON user_gamification;
CREATE POLICY "ug_coach_read" ON user_gamification
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));

-- course_progress
ALTER TABLE course_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON course_progress;
DROP POLICY IF EXISTS "cp_self_all" ON course_progress;
CREATE POLICY "cp_self_all" ON course_progress
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');
DROP POLICY IF EXISTS "cp_coach_read" ON course_progress;
CREATE POLICY "cp_coach_read" ON course_progress
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));

-- check_ins
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON check_ins;
DROP POLICY IF EXISTS "ci_self_all" ON check_ins;
CREATE POLICY "ci_self_all" ON check_ins
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');
DROP POLICY IF EXISTS "ci_coach_read" ON check_ins;
CREATE POLICY "ci_coach_read" ON check_ins
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM coaches WHERE email = current_setting('request.jwt.claims', true)::json->>'email'));


-- ════════════════════════════════════════════════════════════════
-- CLEANUP: Drop obsolete password columns (now handled by auth.users)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE users DROP COLUMN IF EXISTS password;
ALTER TABLE users DROP COLUMN IF EXISTS password_reset_token;
ALTER TABLE users DROP COLUMN IF EXISTS password_reset_expires;


-- ════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- Run these after applying the above to confirm RLS is active.
-- Expected: all rows show rls_enabled = true
-- ════════════════════════════════════════════════════════════════
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'users', 'daily_logs', 'workout_overrides', 'coach_notes',
    'sessions', 'availability', 'blocked_dates', 'messages', 'contact_requests',
    'workout_logs', 'daily_ai_usage', 'weight_history', 'personal_records',
    'body_measurements', 'user_gamification', 'course_progress', 'check_ins', 'coaches'
  )
ORDER BY tablename;
