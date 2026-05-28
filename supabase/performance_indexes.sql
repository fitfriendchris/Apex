-- ================================================================
--  APEX COACHING — PERFORMANCE INDEXES
--  Run this in Supabase SQL Editor to optimize query performance
--  dashboard.supabase.com → your project → SQL Editor → New query
--
--  These indexes cover the most common query patterns:
--  - Fetching daily logs by user + date range (nutrition, dashboard)
--  - Fetching workout logs by user + date (workouts tab)
--  - Weight history lookups for trend charts
--  - AI usage rate limiting (daily counters)
--  - User lookups by email (auth, tier checks)
--  - Check-in queue for coaches (by date, review status)
-- ================================================================

-- Daily logs: user's logs for a date range (most common query)
CREATE INDEX IF NOT EXISTS idx_daily_logs_email_date
  ON daily_logs(user_email, log_date DESC);

-- Workout logs: user's workout history
CREATE INDEX IF NOT EXISTS idx_workout_logs_email_date
  ON workout_logs(user_email, log_date DESC);

-- Weight history: trend charts and weekly analyst
CREATE INDEX IF NOT EXISTS idx_weight_history_email_date
  ON weight_history(user_email, log_date DESC);

-- AI usage: rate limit checks (email + date composite)
CREATE INDEX IF NOT EXISTS idx_daily_ai_usage_email_date
  ON daily_ai_usage(user_email, usage_date);

-- Users: email lookups for tier checks and auth
CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

-- Users: tier filtering for coach analytics
CREATE INDEX IF NOT EXISTS idx_users_tier
  ON users(tier);

-- Check-ins: coach queue sorted by date, filtered by review status
CREATE INDEX IF NOT EXISTS idx_check_ins_date_reviewed
  ON check_ins(checkin_date DESC, reviewed);

-- Check-ins: user's check-in history
CREATE INDEX IF NOT EXISTS idx_check_ins_email_date
  ON check_ins(user_email, checkin_date DESC);

-- Course progress: user's completion status
CREATE INDEX IF NOT EXISTS idx_course_progress_email
  ON course_progress(user_email);

-- Messages: conversation lookups (primary query pattern)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages(conversation_id, created_at DESC);

-- ================================================================
--  ANALYZE — update statistics after creating indexes
-- ================================================================
ANALYZE daily_logs;
ANALYZE workout_logs;
ANALYZE weight_history;
ANALYZE users;
ANALYZE check_ins;
ANALYZE messages;
ANALYZE daily_ai_usage;
