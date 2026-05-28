-- Allow coaches to upgrade client tiers via a secure RPC.
-- Direct UPDATE to users table fails for coaches because RLS only allows
-- self-updates (users_self_update). This SECURITY DEFINER function
-- bypasses RLS after verifying the caller is in the coaches table.

CREATE OR REPLACE FUNCTION public.set_client_tier(p_email text, p_tier text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text;
BEGIN
  -- Extract caller email from JWT claims
  caller_email := current_setting('request.jwt.claims', true)::json->>'email';

  -- Only coaches may call this function
  IF NOT EXISTS (
    SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(caller_email)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: coach access required';
  END IF;

  -- Validate tier value
  IF p_tier NOT IN ('free','ai_basic','core','elite','vip','diamond') THEN
    RAISE EXCEPTION 'Invalid tier value';
  END IF;

  UPDATE users
  SET tier = p_tier
  WHERE LOWER(email) = LOWER(p_email);

  RETURN FOUND; -- true if a row was updated
END;
$$;

-- Grant execute to authenticated users (the function itself validates coach status)
GRANT EXECUTE ON FUNCTION public.set_client_tier(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_tier(text, text) TO anon;
