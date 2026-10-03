-- Application role. Created NOLOGIN here as a fallback; infra (docker init script or the
-- managed database console) gives it LOGIN and a password. The migration owner is not this role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clinic_app') THEN
    CREATE ROLE clinic_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO clinic_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clinic_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clinic_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_logs, visit_amendments FROM clinic_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON drugs FROM clinic_app;
--> statement-breakpoint

-- Row-level security: the backstop behind the scoped data-access layer. The API sets
-- app.clinic_id per transaction; rows of other clinics are invisible and unwritable.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'doctor_profiles', 'schedules', 'schedule_exceptions', 'patients', 'appointments',
    'visits', 'visit_amendments', 'prescriptions', 'prescription_items', 'rx_favorites',
    'rx_share_tokens', 'notification_templates', 'notification_logs', 'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO clinic_app
         USING (clinic_id = nullif(current_setting(''app.clinic_id'', true), '''')::uuid)
         WITH CHECK (clinic_id = nullif(current_setting(''app.clinic_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- Clinic profiles are public (booking page); only the current tenant may modify its own row.
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY clinics_read ON clinics FOR SELECT TO clinic_app USING (true);
--> statement-breakpoint
CREATE POLICY clinics_write ON clinics FOR UPDATE TO clinic_app
  USING (id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
REVOKE INSERT, DELETE ON clinics FROM clinic_app;
--> statement-breakpoint

-- Login happens before the tenant is known. This is the only cross-tenant read the app role
-- can make, and it returns just what the login flow needs.
CREATE FUNCTION auth_lookup_user(p_email text)
RETURNS TABLE (
  id uuid,
  clinic_id uuid,
  password_hash text,
  is_active boolean,
  locked_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.clinic_id, u.password_hash, u.is_active, u.locked_until
  FROM users u
  WHERE u.email = lower(p_email)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO clinic_app;
--> statement-breakpoint

-- No double-booking: a doctor's active scheduled appointments may not overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (type = 'scheduled' AND status NOT IN ('cancelled', 'no_show'));
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_time_order CHECK (end_at > start_at);
--> statement-breakpoint
ALTER TABLE schedules ADD CONSTRAINT schedules_day_range CHECK (day_of_week BETWEEN 0 AND 6);
--> statement-breakpoint
ALTER TABLE schedules ADD CONSTRAINT schedules_time_order CHECK (end_time > start_time);
