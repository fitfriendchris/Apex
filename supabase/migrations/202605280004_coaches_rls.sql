-- Lock down the coaches table — it drives access to ALL user data.
-- Without RLS, anyone with the anon key can read, insert, update, or delete
-- coach rows, effectively self-promoting to coach and bypassing all other policies.

ALTER TABLE coaches ENABLE ROW LEVEL SECURITY;

-- Drop any existing permissive policies
DROP POLICY IF EXISTS "coaches_all" ON coaches;
DROP POLICY IF EXISTS "coaches_read" ON coaches;
DROP POLICY IF EXISTS "coaches_insert" ON coaches;
DROP POLICY IF EXISTS "coaches_update" ON coaches;
DROP POLICY IF EXISTS "coaches_delete" ON coaches;

-- Block ALL API access. Coaches are managed via Supabase Dashboard / CLI only.
CREATE POLICY "coaches_admin_only" ON coaches
  FOR ALL USING (false);
