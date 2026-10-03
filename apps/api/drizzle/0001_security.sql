-- Database roles
--   clinic_app       the API's login role; every tenant query is subject to row-level security.
--   clinic_platform  assumed with SET LOCAL ROLE for the platform console. It has no grants on any
--                    patient-data table, so platform code cannot read PHI even by mistake.
-- Both are created NOLOGIN as a fallback; infra gives clinic_app LOGIN and a password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clinic_app') THEN
    CREATE ROLE clinic_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clinic_platform') THEN
    CREATE ROLE clinic_platform NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT clinic_platform TO clinic_app WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO clinic_app, clinic_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clinic_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clinic_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_logs, visit_amendments FROM clinic_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON drugs FROM clinic_app;
--> statement-breakpoint
REVOKE INSERT, DELETE ON clinics FROM clinic_app;
--> statement-breakpoint
REVOKE DELETE ON users FROM clinic_app;
--> statement-breakpoint

-- Request context, set per transaction by the API.
CREATE FUNCTION app_clinic_id() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.clinic_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- Tenant tables: rows of other clinics are invisible and unwritable.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'doctor_profiles', 'secretary_assignments', 'schedules', 'schedule_exceptions', 'patients',
    'appointments', 'visits', 'visit_amendments', 'prescriptions', 'prescription_items',
    'rx_favorites', 'rx_share_tokens', 'notification_templates', 'notification_logs', 'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO clinic_app
         USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- Memberships: a clinic sees its own staff; a user sees their own memberships (clinic switcher).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_read ON memberships FOR SELECT TO clinic_app
  USING (clinic_id = app_clinic_id() OR user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY memberships_insert ON memberships FOR INSERT TO clinic_app
  WITH CHECK (clinic_id = app_clinic_id());
--> statement-breakpoint
CREATE POLICY memberships_update ON memberships FOR UPDATE TO clinic_app
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
--> statement-breakpoint
CREATE POLICY memberships_delete ON memberships FOR DELETE TO clinic_app
  USING (clinic_id = app_clinic_id());
--> statement-breakpoint

-- Users: visible to themselves and to clinics they belong to. Only the user's own row is
-- updatable (sign-in counters); clinics change access through memberships, never the login.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_read ON users FOR SELECT TO clinic_app
  USING (
    id = app_user_id()
    OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.clinic_id = app_clinic_id())
  );
--> statement-breakpoint
CREATE POLICY users_update_self ON users FOR UPDATE TO clinic_app
  USING (id = app_user_id()) WITH CHECK (id = app_user_id());
--> statement-breakpoint
CREATE POLICY users_insert ON users FOR INSERT TO clinic_app
  WITH CHECK (app_clinic_id() IS NOT NULL);
--> statement-breakpoint

-- Clinic profiles are public (booking page); only the current tenant may modify its own row.
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY clinics_read ON clinics FOR SELECT TO clinic_app USING (true);
--> statement-breakpoint
CREATE POLICY clinics_write ON clinics FOR UPDATE TO clinic_app
  USING (id = app_clinic_id()) WITH CHECK (id = app_clinic_id());
--> statement-breakpoint

-- Platform console: clinics, logins, memberships and doctor credentials. No patient data.
GRANT SELECT, INSERT, UPDATE ON clinics, memberships, doctor_profiles TO clinic_platform;
--> statement-breakpoint
GRANT SELECT (id, name, email, is_active, is_platform_admin, created_at, updated_at), INSERT
  ON users TO clinic_platform;
--> statement-breakpoint
GRANT INSERT ON audit_logs TO clinic_platform;
--> statement-breakpoint
CREATE POLICY platform_access ON clinics FOR ALL TO clinic_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY platform_access ON users FOR ALL TO clinic_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY platform_access ON memberships FOR ALL TO clinic_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY platform_access ON doctor_profiles FOR ALL TO clinic_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY platform_audit ON audit_logs FOR INSERT TO clinic_platform WITH CHECK (true);
--> statement-breakpoint

-- Patient counts per clinic for the platform console: numbers only, never rows.
CREATE FUNCTION platform_patient_counts()
RETURNS TABLE (clinic_id uuid, patients bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT p.clinic_id, count(*) FROM patients p GROUP BY p.clinic_id $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_patient_counts() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_patient_counts() TO clinic_platform;
--> statement-breakpoint

-- Sign-in happens before any context exists; returns only what the login flow needs.
CREATE FUNCTION auth_lookup_user(p_email text)
RETURNS TABLE (id uuid, password_hash text, is_active boolean, locked_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.id, u.password_hash, u.is_active, u.locked_until FROM users u WHERE u.email = lower(p_email)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO clinic_app;
--> statement-breakpoint

-- Adding an existing person (e.g. a doctor from another clinic) as staff needs their id only.
CREATE FUNCTION user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT u.id FROM users u WHERE u.email = lower(p_email) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION user_id_by_email(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION user_id_by_email(text) TO clinic_app, clinic_platform;
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
