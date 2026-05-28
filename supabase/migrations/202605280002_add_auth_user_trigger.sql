-- Auto-create public.users profile when a new auth.users row is inserted.
-- This is critical when email confirmation is enabled (Supabase default):
-- signUp() returns no session, so the frontend can't create the row via RLS.
-- The trigger reads all registration data from raw_user_meta_data populated
-- by doRegister() and inserts a complete profile row immediately.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    INSERT INTO public.users (
      email,
      first_name,
      last_name,
      age,
      sex,
      height,
      weight,
      goal_weight,
      goal,
      activity,
      diet,
      transform,
      start_weight,
      join_date,
      tier,
      email_verified
    ) VALUES (
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'age', '')::int,
      NEW.raw_user_meta_data->>'sex',
      NULLIF(NEW.raw_user_meta_data->>'height', '')::numeric,
      NULLIF(NEW.raw_user_meta_data->>'weight', '')::numeric,
      NULLIF(NEW.raw_user_meta_data->>'goal_weight', '')::numeric,
      NEW.raw_user_meta_data->>'goal',
      NEW.raw_user_meta_data->>'activity',
      NEW.raw_user_meta_data->>'diet',
      NEW.raw_user_meta_data->>'transform',
      NULLIF(NEW.raw_user_meta_data->>'start_weight', '')::numeric,
      COALESCE(NEW.raw_user_meta_data->>'join_date', CURRENT_DATE::text),
      COALESCE(NEW.raw_user_meta_data->>'tier', 'free'),
      false
    )
    ON CONFLICT (email) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Never block auth registration if the profile insert fails
    RAISE WARNING 'handle_new_user failed for %: %', NEW.email, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to auth.users (must be created in the auth schema)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
