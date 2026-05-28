-- Migration: add increment_ai_usage RPC matching production schema (usage_date / scan_count)
-- 2026-05-28

-- Atomically upserts the scan counter — safe for concurrent requests.
-- Runs as SECURITY DEFINER so it bypasses RLS and always succeeds.
CREATE OR REPLACE FUNCTION increment_ai_usage(p_email text, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO daily_ai_usage (user_email, usage_date, scan_count)
  VALUES (p_email, p_date, 1)
  ON CONFLICT (user_email, usage_date)
  DO UPDATE SET scan_count = daily_ai_usage.scan_count + 1;
END;
$$;

-- Grant execute to authenticated and anon roles (edge functions call via anon key + JWT)
GRANT EXECUTE ON FUNCTION increment_ai_usage(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_ai_usage(text, date) TO anon;
