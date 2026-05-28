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

-- ── FOREIGN KEY CASCADES (orphaned row protection) ────────────
ALTER TABLE daily_logs       ADD CONSTRAINT IF NOT EXISTS fk_daily_logs_user       FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE workout_logs     ADD CONSTRAINT IF NOT EXISTS fk_workout_logs_user     FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE workout_overrides ADD CONSTRAINT IF NOT EXISTS fk_workout_overrides_user FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE coach_notes      ADD CONSTRAINT IF NOT EXISTS fk_coach_notes_user      FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE sessions         ADD CONSTRAINT IF NOT EXISTS fk_sessions_user         FOREIGN KEY (client_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE messages         ADD CONSTRAINT IF NOT EXISTS fk_messages_sender        FOREIGN KEY (sender_email) REFERENCES users(email) ON DELETE SET NULL;
ALTER TABLE messages         ADD CONSTRAINT IF NOT EXISTS fk_messages_recipient    FOREIGN KEY (recipient_email) REFERENCES users(email) ON DELETE SET NULL;
ALTER TABLE weight_history   ADD CONSTRAINT IF NOT EXISTS fk_weight_history_user    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE personal_records ADD CONSTRAINT IF NOT EXISTS fk_personal_records_user FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE body_measurements ADD CONSTRAINT IF NOT EXISTS fk_body_measurements_user FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE user_gamification ADD CONSTRAINT IF NOT EXISTS fk_user_gamification_user FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE course_progress  ADD CONSTRAINT IF NOT EXISTS fk_course_progress_user   FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE check_ins        ADD CONSTRAINT IF NOT EXISTS fk_check_ins_user         FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;
ALTER TABLE daily_ai_usage   ADD CONSTRAINT IF NOT EXISTS fk_daily_ai_usage_user    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE;

-- ── CHECK CONSTRAINTS ─────────────────────────────────────────
ALTER TABLE users ADD CONSTRAINT IF NOT EXISTS chk_users_age_positive     CHECK (age IS NULL OR age > 0);
ALTER TABLE users ADD CONSTRAINT IF NOT EXISTS chk_users_weight_positive  CHECK (weight IS NULL OR weight > 0);
ALTER TABLE daily_logs ADD CONSTRAINT IF NOT EXISTS chk_daily_logs_water_nonnegative CHECK (water IS NULL OR water >= 0);
ALTER TABLE check_ins ADD CONSTRAINT IF NOT EXISTS chk_check_ins_energy CHECK (energy IS NULL OR (energy >= 1 AND energy <= 10));
ALTER TABLE check_ins ADD CONSTRAINT IF NOT EXISTS chk_check_ins_sleep  CHECK (sleep IS NULL OR (sleep >= 1 AND sleep <= 10));
ALTER TABLE check_ins ADD CONSTRAINT IF NOT EXISTS chk_check_ins_stress CHECK (stress IS NULL OR (stress >= 1 AND stress <= 10));
ALTER TABLE check_ins ADD CONSTRAINT IF NOT EXISTS chk_check_ins_perf   CHECK (perf IS NULL OR (perf >= 1 AND perf <= 10));

-- ── LOWERCASE EMAIL TRIGGER ───────────────────────────────────
CREATE OR REPLACE FUNCTION apex_lowercase_email()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    NEW.email = LOWER(NEW.email);
  ELSIF TG_TABLE_NAME IN ('daily_logs','workout_logs','workout_overrides','coach_notes','sessions','messages','contact_requests','weight_history','personal_records','body_measurements','user_gamification','course_progress','check_ins','daily_ai_usage') THEN
    NEW.user_email = LOWER(NEW.user_email);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_lowercase ON users;
CREATE TRIGGER trg_users_lowercase BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION apex_lowercase_email();

DROP TRIGGER IF EXISTS trg_daily_logs_lowercase ON daily_logs;
CREATE TRIGGER trg_daily_logs_lowercase BEFORE INSERT OR UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION apex_lowercase_email();

DROP TRIGGER IF EXISTS trg_workout_logs_lowercase ON workout_logs;
CREATE TRIGGER trg_workout_logs_lowercase BEFORE INSERT OR UPDATE ON workout_logs
  FOR EACH ROW EXECUTE FUNCTION apex_lowercase_email();

DROP TRIGGER IF EXISTS trg_sessions_lowercase ON sessions;
CREATE TRIGGER trg_sessions_lowercase BEFORE INSERT OR UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION apex_lowercase_email();
