-- ================================================================
--  APEX COACHING — CREATE ALL TABLES (Idempotent)
--  Run this in Supabase SQL Editor if ANY table is missing.
--  Safe to re-run — all statements use IF NOT EXISTS.
-- ================================================================

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
  email text PRIMARY KEY,
  first_name text,
  last_name text,
  age int,
  sex text,
  height numeric,
  weight numeric,
  goal_weight numeric,
  goal text,
  activity text,
  diet text,
  transform text,
  start_weight numeric,
  join_date text,
  tier text DEFAULT 'free',
  tier_expires date,
  stripe_customer_id text,
  stripe_session_id text,
  coach_id text DEFAULT 'coach1',
  created_at timestamptz DEFAULT now(),
  email_verified boolean DEFAULT false,
  email_verify_token text,
  email_verify_expires bigint
);

-- 2. DAILY_LOGS
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

-- 3. WORKOUT_LOGS
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

-- 4. WORKOUT_OVERRIDES
CREATE TABLE IF NOT EXISTS workout_overrides (
  user_email text,
  day_name text,
  focus text,
  notes text,
  PRIMARY KEY (user_email, day_name)
);

-- 5. COACH_NOTES
CREATE TABLE IF NOT EXISTS coach_notes (
  user_email text PRIMARY KEY,
  notes text
);

-- 6. SESSIONS
CREATE TABLE IF NOT EXISTS sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_email text,
  client_name text,
  session_type text,
  session_date date,
  session_time text,
  duration_mins int DEFAULT 30,
  status text DEFAULT 'pending',
  notes text,
  meet_link text,
  cal_link text,
  coach_notes text,
  created_at timestamptz DEFAULT now()
);

-- 7. AVAILABILITY
CREATE TABLE IF NOT EXISTS availability (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  day_name text UNIQUE NOT NULL,
  enabled bool DEFAULT true,
  start_time text DEFAULT '09:00',
  end_time text DEFAULT '17:00',
  slot_duration int DEFAULT 30
);

-- 8. BLOCKED_DATES
CREATE TABLE IF NOT EXISTS blocked_dates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  block_date date NOT NULL,
  block_type text DEFAULT 'full',
  reason text,
  created_at timestamptz DEFAULT now()
);

-- 9. MESSAGES
CREATE TABLE IF NOT EXISTS messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id text NOT NULL,
  sender_email text,
  recipient_email text,
  content text,
  created_at timestamptz DEFAULT now()
);

-- 10. CONTACT_REQUESTS
CREATE TABLE IF NOT EXISTS contact_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  from_email text,
  from_name text,
  message text,
  created_at timestamptz DEFAULT now()
);

-- 11. DAILY_AI_USAGE
CREATE TABLE IF NOT EXISTS daily_ai_usage (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email  text NOT NULL,
  usage_date  date NOT NULL,
  scan_count  int  DEFAULT 0,
  UNIQUE(user_email, usage_date)
);

-- 12. WEIGHT_HISTORY
CREATE TABLE IF NOT EXISTS weight_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  log_date date NOT NULL,
  weight_lbs numeric(5,1) NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_email, log_date)
);

-- 13. PERSONAL_RECORDS
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

-- 14. BODY_MEASUREMENTS
CREATE TABLE IF NOT EXISTS body_measurements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  site_name text NOT NULL,
  value_inches numeric(5,2),
  measured_date date,
  created_at timestamptz DEFAULT now()
);

-- 15. USER_GAMIFICATION
CREATE TABLE IF NOT EXISTS user_gamification (
  user_email text PRIMARY KEY,
  total_xp int DEFAULT 0,
  level int DEFAULT 1,
  streak_days int DEFAULT 0,
  badges jsonb DEFAULT '[]',
  last_activity date,
  updated_at timestamptz DEFAULT now()
);

-- 16. COURSE_PROGRESS
CREATE TABLE IF NOT EXISTS course_progress (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  course_id text NOT NULL,
  progress_data jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_email, course_id)
);

-- 17. CHECK_INS
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

-- 18. COACHES
CREATE TABLE IF NOT EXISTS coaches (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email      text UNIQUE NOT NULL,
  name       text,
  created_at timestamptz DEFAULT now()
);

-- Insert default coach
INSERT INTO coaches (email, name)
VALUES ('fitfriendchris@gmail.com', 'Chris')
ON CONFLICT (email) DO NOTHING;

-- ── INDEXES (performance) ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_daily_logs_user_date ON daily_logs(user_email, log_date);
CREATE INDEX IF NOT EXISTS idx_workout_logs_user_date ON workout_logs(user_email, log_date);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_client ON sessions(client_email, session_date);
CREATE INDEX IF NOT EXISTS idx_weight_history_user_date ON weight_history(user_email, log_date);
CREATE INDEX IF NOT EXISTS idx_check_ins_user_date ON check_ins(user_email, date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON daily_ai_usage(user_email, usage_date);
CREATE INDEX IF NOT EXISTS idx_coaches_email ON coaches(email);

-- ── VERIFY ────────────────────────────────────────────────────
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'users', 'daily_logs', 'workout_logs', 'workout_overrides', 'coach_notes',
    'sessions', 'availability', 'blocked_dates', 'messages', 'contact_requests',
    'daily_ai_usage', 'weight_history', 'personal_records', 'body_measurements',
    'user_gamification', 'course_progress', 'check_ins', 'coaches'
  )
ORDER BY tablename;
