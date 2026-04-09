-- ─────────────────────────────────────────────────────────────────────────────
-- daily_ai_usage table + RPC
-- Run this in Supabase SQL Editor once before deploying anthropic-proxy.
-- Idempotent: safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

-- Track per-user, per-day AI API call counts
CREATE TABLE IF NOT EXISTS daily_ai_usage (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  date       date NOT NULL DEFAULT CURRENT_DATE,
  calls      int  NOT NULL DEFAULT 0 CHECK (calls >= 0),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_email, date)
);

-- Index for fast per-user daily lookups (used on every AI call)
CREATE INDEX IF NOT EXISTS idx_daily_ai_usage_email_date
  ON daily_ai_usage (user_email, date);

-- Enable RLS
ALTER TABLE daily_ai_usage ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────────────────────
-- Drop old catch-all policy if it exists (from previous deploys)
DROP POLICY IF EXISTS "Service role full access" ON daily_ai_usage;
DROP POLICY IF EXISTS "Users read own usage"     ON daily_ai_usage;

-- Users can only read their own usage (authenticated via Supabase Auth JWT)
CREATE POLICY "Users read own usage"
  ON daily_ai_usage
  FOR SELECT
  USING (auth.jwt() ->> 'email' = user_email);

-- Service role (edge functions using service key) can INSERT
CREATE POLICY "Service role insert"
  ON daily_ai_usage
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Service role can UPDATE (for the increment RPC)
CREATE POLICY "Service role update"
  ON daily_ai_usage
  FOR UPDATE
  USING (auth.role() = 'service_role');

-- ── RPC: increment_ai_usage ───────────────────────────────────────────────────
-- Atomically upserts the call counter — safe for concurrent requests.
-- Runs as SECURITY DEFINER so it bypasses RLS and always succeeds
-- regardless of which role the calling edge function uses.
CREATE OR REPLACE FUNCTION increment_ai_usage(p_email text, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public   -- prevent search-path injection
AS $$
BEGIN
  INSERT INTO daily_ai_usage (user_email, date, calls)
  VALUES (p_email, p_date, 1)
  ON CONFLICT (user_email, date)
  DO UPDATE SET calls = daily_ai_usage.calls + 1;
END;
$$;

-- Grant execute to authenticated and anon roles (edge functions call via anon key + JWT)
GRANT EXECUTE ON FUNCTION increment_ai_usage(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_ai_usage(text, date) TO anon;

-- ── Optional: auto-purge records older than 90 days ───────────────────────────
-- Enable pg_cron extension first: CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Then run once:
--   SELECT cron.schedule(
--     'purge-ai-usage',
--     '0 3 * * *',   -- 3 AM daily
--     'DELETE FROM daily_ai_usage WHERE date < CURRENT_DATE - 90'
--   );

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  table_name,
  row_security
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'daily_ai_usage';
