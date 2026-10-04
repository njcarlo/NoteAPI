-- Public cancel links arrive without any tenant context. Returns only the ids needed to
-- continue inside that clinic's scope; the token itself is stored hashed.
CREATE FUNCTION appointment_by_cancel_token(p_token_hash text)
RETURNS TABLE (id uuid, clinic_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT a.id, a.clinic_id FROM appointments a WHERE a.cancel_token_hash = p_token_hash $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION appointment_by_cancel_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION appointment_by_cancel_token(text) TO clinic_app;
--> statement-breakpoint
CREATE INDEX appointments_doctor_day_idx ON appointments (doctor_id, start_at)
  WHERE status NOT IN ('cancelled', 'no_show');
