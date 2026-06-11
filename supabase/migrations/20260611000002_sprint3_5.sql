-- Sprint 3 scaffold: multi-tenant coach-as-customer (additive)
ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_id uuid REFERENCES coaches(id);
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'founder';
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS stripe_customer_id text;
CREATE INDEX IF NOT EXISTS idx_users_coach ON users (coach_id);

-- Sprint 5: Jarvis event triggers
CREATE OR REPLACE FUNCTION notify_jarvis_tier_change() RETURNS trigger AS $$
BEGIN
  IF NEW.tier IS DISTINCT FROM OLD.tier THEN
    INSERT INTO jarvis_events (event_type, user_id, data)
    VALUES ('tier_change', NEW.id, jsonb_build_object(
      'email', NEW.email, 'from', COALESCE(OLD.tier,'free'), 'to', COALESCE(NEW.tier,'free')));
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_jarvis_tier_change ON users;
CREATE TRIGGER trg_jarvis_tier_change AFTER UPDATE OF tier ON users
  FOR EACH ROW EXECUTE FUNCTION notify_jarvis_tier_change();

CREATE OR REPLACE FUNCTION notify_jarvis_pr() RETURNS trigger AS $$
BEGIN
  INSERT INTO jarvis_events (event_type, data)
  VALUES ('pr_hit', jsonb_build_object(
    'email', NEW.user_email, 'lift', NEW.lift_name, 'weight_lbs', NEW.weight_lbs, 'reps', NEW.reps));
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_jarvis_pr ON personal_records;
CREATE TRIGGER trg_jarvis_pr AFTER INSERT ON personal_records
  FOR EACH ROW EXECUTE FUNCTION notify_jarvis_pr();

CREATE OR REPLACE FUNCTION notify_jarvis_checkin() RETURNS trigger AS $$
BEGIN
  INSERT INTO jarvis_events (event_type, data)
  VALUES ('checkin_submitted', jsonb_build_object(
    'email', NEW.user_email, 'week', NEW.week, 'weight', NEW.weight));
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_jarvis_checkin ON check_ins;
CREATE TRIGGER trg_jarvis_checkin AFTER INSERT ON check_ins
  FOR EACH ROW EXECUTE FUNCTION notify_jarvis_checkin();
