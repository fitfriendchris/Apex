-- ================================================================
--  APEX COACHING — RLS HARDENING + SCHEMA FIXES
--  Run this AFTER create_all_tables.sql and enable_rls.sql.
--  Safe to re-run — all statements are idempotent.
-- ================================================================

-- ── 1. CASE-INSENSITIVE EMAIL MATCHING ─────────────────────────
-- Prevents users from being locked out due to mixed-case emails.
-- Re-create all policies with LOWER() on both sides.

DROP POLICY IF EXISTS "users_self_read" ON users;
CREATE POLICY "users_self_read" ON users
  FOR SELECT USING (LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "users_self_update" ON users;
CREATE POLICY "users_self_update" ON users
  FOR UPDATE USING (LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "coach_read_all_users" ON users;
CREATE POLICY "coach_read_all_users" ON users
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "logs_self_all" ON daily_logs;
CREATE POLICY "logs_self_all" ON daily_logs
  FOR ALL USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "coach_read_logs" ON daily_logs;
CREATE POLICY "coach_read_logs" ON daily_logs
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "overrides_self_read" ON workout_overrides;
CREATE POLICY "overrides_self_read" ON workout_overrides
  FOR SELECT USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "overrides_coach_all" ON workout_overrides;
CREATE POLICY "overrides_coach_all" ON workout_overrides
  FOR ALL USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "cnotes_self_read" ON coach_notes;
CREATE POLICY "cnotes_self_read" ON coach_notes
  FOR SELECT USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "cnotes_coach_all" ON coach_notes;
CREATE POLICY "cnotes_coach_all" ON coach_notes
  FOR ALL USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "sessions_self_read" ON sessions;
CREATE POLICY "sessions_self_read" ON sessions
  FOR SELECT USING (LOWER(client_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "sessions_self_insert" ON sessions;
CREATE POLICY "sessions_self_insert" ON sessions
  FOR INSERT WITH CHECK (LOWER(client_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "sessions_coach_all" ON sessions;
CREATE POLICY "sessions_coach_all" ON sessions
  FOR ALL USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

-- Tighten availability: require authenticated user (not anon)
DROP POLICY IF EXISTS "avail_read" ON availability;
CREATE POLICY "avail_read" ON availability
  FOR SELECT USING (current_setting('request.jwt.claims', true)::json->>'email' IS NOT NULL);

DROP POLICY IF EXISTS "avail_coach_write" ON availability;
CREATE POLICY "avail_coach_write" ON availability
  FOR ALL USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

-- Tighten blocked_dates: require authenticated user (not anon)
DROP POLICY IF EXISTS "blocked_read" ON blocked_dates;
CREATE POLICY "blocked_read" ON blocked_dates
  FOR SELECT USING (current_setting('request.jwt.claims', true)::json->>'email' IS NOT NULL);

DROP POLICY IF EXISTS "blocked_coach_write" ON blocked_dates;
CREATE POLICY "blocked_coach_write" ON blocked_dates
  FOR ALL USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "messages_participants" ON messages;
CREATE POLICY "messages_participants" ON messages
  FOR ALL USING (
    conversation_id LIKE (current_setting('request.jwt.claims', true)::json->>'email') || '%'
    OR conversation_id LIKE '%:' || (current_setting('request.jwt.claims', true)::json->>'email')
    OR EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'))
  );

DROP POLICY IF EXISTS "contact_insert" ON contact_requests;
CREATE POLICY "contact_insert" ON contact_requests
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "contact_self_read" ON contact_requests;
CREATE POLICY "contact_self_read" ON contact_requests
  FOR SELECT USING (LOWER(from_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "contact_coach_read" ON contact_requests;
CREATE POLICY "contact_coach_read" ON contact_requests
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "wlogs_self_all" ON workout_logs;
CREATE POLICY "wlogs_self_all" ON workout_logs
  FOR ALL USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "wlogs_coach_read" ON workout_logs;
CREATE POLICY "wlogs_coach_read" ON workout_logs
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "ai_usage_self" ON daily_ai_usage;
CREATE POLICY "ai_usage_self" ON daily_ai_usage
  FOR ALL USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "wh_self_all" ON weight_history;
CREATE POLICY "wh_self_all" ON weight_history
  FOR ALL USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "wh_coach_read" ON weight_history;
CREATE POLICY "wh_coach_read" ON weight_history
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "pr_self_all" ON personal_records;
CREATE POLICY "pr_self_all" ON personal_records
  FOR ALL USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "pr_coach_read" ON personal_records;
CREATE POLICY "pr_coach_read" ON personal_records
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "bm_self_all" ON body_measurements;
CREATE POLICY "bm_self_all" ON body_measurements
  FOR ALL USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "bm_coach_read" ON body_measurements;
CREATE POLICY "bm_coach_read" ON body_measurements
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "ug_self_all" ON user_gamification;
CREATE POLICY "ug_self_all" ON user_gamification
  FOR ALL USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "ug_coach_read" ON user_gamification;
CREATE POLICY "ug_coach_read" ON user_gamification
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "cp_self_all" ON course_progress;
CREATE POLICY "cp_self_all" ON course_progress
  FOR ALL USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "cp_coach_read" ON course_progress;
CREATE POLICY "cp_coach_read" ON course_progress
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));

DROP POLICY IF EXISTS "ci_self_all" ON check_ins;
CREATE POLICY "ci_self_all" ON check_ins
  FOR ALL USING (LOWER(user_email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'));

DROP POLICY IF EXISTS "ci_coach_read" ON check_ins;
CREATE POLICY "ci_coach_read" ON check_ins
  FOR SELECT USING (EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email')));


-- ── 2. FOREIGN KEY CASCADES (orphaned row protection) ──────────
-- These are safe to add only when tables are empty (pre-launch).
-- If tables already have data that doesn't match users.email, add
-- will fail — clean data first or run manually per-table.

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

-- ── 3. CHECK CONSTRAINTS (data integrity) ──────────────────────
ALTER TABLE users ADD CONSTRAINT IF NOT EXISTS chk_users_age_positive     CHECK (age IS NULL OR age > 0);
ALTER TABLE users ADD CONSTRAINT IF NOT EXISTS chk_users_weight_positive  CHECK (weight IS NULL OR weight > 0);
ALTER TABLE daily_logs ADD CONSTRAINT IF NOT EXISTS chk_daily_logs_water_nonnegative CHECK (water IS NULL OR water >= 0);
ALTER TABLE check_ins ADD CONSTRAINT IF NOT EXISTS chk_check_ins_energy CHECK (energy IS NULL OR (energy >= 1 AND energy <= 10));
ALTER TABLE check_ins ADD CONSTRAINT IF NOT EXISTS chk_check_ins_sleep  CHECK (sleep IS NULL OR (sleep >= 1 AND sleep <= 10));
ALTER TABLE check_ins ADD CONSTRAINT IF NOT EXISTS chk_check_ins_stress CHECK (stress IS NULL OR (stress >= 1 AND stress <= 10));
ALTER TABLE check_ins ADD CONSTRAINT IF NOT EXISTS chk_check_ins_perf   CHECK (perf IS NULL OR (perf >= 1 AND perf <= 10));

-- ── 4. LOWERCASE EMAIL TRIGGER (prevent mixed-case insert issues) ─
-- Automatically lowercases email on insert/update for tables that use email as lookup key.
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

-- Drop and recreate triggers on all relevant tables
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

-- ── 5. VERIFICATION ───────────────────────────────────────────
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users','daily_logs','workout_logs','workout_overrides','coach_notes','sessions','availability','blocked_dates','messages','contact_requests','workout_logs','daily_ai_usage','weight_history','personal_records','body_measurements','user_gamification','course_progress','check_ins','coaches')
ORDER BY tablename;
