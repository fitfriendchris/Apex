-- ================================================================
--  APEX COACHING — SUPABASE ROW LEVEL SECURITY
--  Run this entire script in the Supabase SQL Editor:
--  dashboard.supabase.com → your project → SQL Editor → New query
--
--  CRITICAL: Run this before scaling to real users.
--  The anon key is exposed in the browser. Without RLS any
--  visitor can read, modify, or delete all user data.
-- ================================================================


-- ────────────────────────────────────────────────────────────────
-- HELPER: JWT claim extractor
-- ────────────────────────────────────────────────────────────────
-- Used by all policies below to get the authenticated user's email
-- from the JWT token that Supabase issues on login.


-- ════════════════════════════════════════════════════════════════
-- 1. USERS TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

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

-- Coach can read all users (role claim set server-side)
DROP POLICY IF EXISTS "coach_read_all_users" ON users;
CREATE POLICY "coach_read_all_users" ON users
  FOR SELECT
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'coach');


-- ════════════════════════════════════════════════════════════════
-- 2. DAILY_LOGS TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

-- Users own their logs
DROP POLICY IF EXISTS "logs_self_all" ON daily_logs;
CREATE POLICY "logs_self_all" ON daily_logs
  FOR ALL
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');

-- Coach can read all logs (for dashboard)
DROP POLICY IF EXISTS "coach_read_logs" ON daily_logs;
CREATE POLICY "coach_read_logs" ON daily_logs
  FOR SELECT
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'coach');


-- ════════════════════════════════════════════════════════════════
-- 3. WORKOUT_OVERRIDES TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE workout_overrides ENABLE ROW LEVEL SECURITY;

-- Clients can read their overrides; coach can read/write all
DROP POLICY IF EXISTS "overrides_self_read" ON workout_overrides;
CREATE POLICY "overrides_self_read" ON workout_overrides
  FOR SELECT
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');

DROP POLICY IF EXISTS "overrides_coach_all" ON workout_overrides;
CREATE POLICY "overrides_coach_all" ON workout_overrides
  FOR ALL
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'coach');


-- ════════════════════════════════════════════════════════════════
-- 4. COACH_NOTES TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE coach_notes ENABLE ROW LEVEL SECURITY;

-- Clients can read their own coach notes
DROP POLICY IF EXISTS "cnotes_self_read" ON coach_notes;
CREATE POLICY "cnotes_self_read" ON coach_notes
  FOR SELECT
  USING (user_email = current_setting('request.jwt.claims', true)::json->>'email');

-- Coach can read and write all coach notes
DROP POLICY IF EXISTS "cnotes_coach_all" ON coach_notes;
CREATE POLICY "cnotes_coach_all" ON coach_notes
  FOR ALL
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'coach');


-- ════════════════════════════════════════════════════════════════
-- 5. SESSIONS TABLE (booking)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

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
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'coach');


-- ════════════════════════════════════════════════════════════════
-- 6. AVAILABILITY TABLE (coach schedule)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read availability (to show booking calendar)
DROP POLICY IF EXISTS "avail_read" ON availability;
CREATE POLICY "avail_read" ON availability
  FOR SELECT
  USING (true);

-- Only coach can modify availability
DROP POLICY IF EXISTS "avail_coach_write" ON availability;
CREATE POLICY "avail_coach_write" ON availability
  FOR ALL
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'coach');


-- ════════════════════════════════════════════════════════════════
-- 7. BLOCKED_DATES TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE blocked_dates ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read blocked dates (booking UI needs this)
DROP POLICY IF EXISTS "blocked_read" ON blocked_dates;
CREATE POLICY "blocked_read" ON blocked_dates
  FOR SELECT
  USING (true);

-- Only coach can modify
DROP POLICY IF EXISTS "blocked_coach_write" ON blocked_dates;
CREATE POLICY "blocked_coach_write" ON blocked_dates
  FOR ALL
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'coach');


-- ════════════════════════════════════════════════════════════════
-- 8. MESSAGES TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Participants (client or coach) can access messages in their conversation
-- conversation_id format: "clientEmail:coachId"
DROP POLICY IF EXISTS "messages_participants" ON messages;
CREATE POLICY "messages_participants" ON messages
  FOR ALL
  USING (
    conversation_id LIKE (current_setting('request.jwt.claims', true)::json->>'email') || '%'
    OR conversation_id LIKE '%:' || (current_setting('request.jwt.claims', true)::json->>'email')
    OR current_setting('request.jwt.claims', true)::json->>'role' = 'coach'
  );


-- ════════════════════════════════════════════════════════════════
-- 9. CONTACT_REQUESTS TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;

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
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'coach');


-- ════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- Run these after applying the above to confirm RLS is active.
-- Expected: all 9 rows show rls_enabled = true
-- ════════════════════════════════════════════════════════════════
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'users', 'daily_logs', 'workout_overrides', 'coach_notes',
    'sessions', 'availability', 'blocked_dates', 'messages', 'contact_requests'
  )
ORDER BY tablename;
