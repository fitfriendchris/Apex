-- ════════════════════════════════════════════════════════════════════════════
--  CRITICAL: Prevent clients from self-granting paid tiers / payment state.
--
--  The "users_self_update" RLS policy allows a signed-in user to UPDATE their own
--  row, with NO column restriction. That let any authenticated user PATCH
--  /rest/v1/users { "tier": "diamond" } straight to the database and unlock the
--  top paid plan for free — the server-side Stripe verification only guarded the
--  frontend code path, not the table.
--
--  Fix: a BEFORE UPDATE trigger that rejects CHANGES to privileged columns when
--  the caller is the public `anon` or `authenticated` role. Trusted paths still
--  work because they run under a different role:
--    • verify-stripe-session  → uses the service_role key  → current_user = 'service_role'
--    • set_client_tier (coach) → SECURITY DEFINER function  → current_user = function owner
--    • profile saves that re-send the SAME tier value pass, because the value is
--      not DISTINCT from the existing one (no change = allowed).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_user_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER          -- run as the calling role so current_user is meaningful
SET search_path = public
AS $$
BEGIN
  -- Privileged contexts (service_role key, SECURITY DEFINER funcs, admin/migrations)
  -- run under a role other than anon/authenticated — let them through untouched.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- Public callers may NOT change any of these columns. Re-sending the same
  -- value (e.g. a profile save that echoes the current tier) is fine because
  -- IS DISTINCT FROM treats equal values — including NULLs — as not changed.
  IF NEW.tier                 IS DISTINCT FROM OLD.tier
  OR NEW.tier_expires         IS DISTINCT FROM OLD.tier_expires
  OR NEW.stripe_customer_id   IS DISTINCT FROM OLD.stripe_customer_id
  OR NEW.stripe_session_id    IS DISTINCT FROM OLD.stripe_session_id
  OR NEW.email_verified       IS DISTINCT FROM OLD.email_verified
  OR NEW.email_verify_token   IS DISTINCT FROM OLD.email_verify_token
  OR NEW.email_verify_expires IS DISTINCT FROM OLD.email_verify_expires
  THEN
    RAISE EXCEPTION 'Cannot modify billing or verification fields'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_privileged_columns ON public.users;
CREATE TRIGGER trg_protect_user_privileged_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_privileged_columns();
