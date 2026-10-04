ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON outbox TO clinic_app
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
--> statement-breakpoint

-- The relay claims due rows across clinics. It gets ids only and continues inside each clinic's
-- scope. Rows stuck in 'dispatching' (relay crashed before handing off) are reclaimed after 5 min.
CREATE FUNCTION claim_due_outbox(p_limit int)
RETURNS TABLE (id uuid, clinic_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE outbox o SET status = 'dispatching', claimed_at = now()
  WHERE o.id IN (
    SELECT x.id FROM outbox x
    WHERE (x.status = 'pending' AND x.run_at <= now())
       OR (x.status = 'dispatching' AND x.claimed_at < now() - interval '5 minutes')
    ORDER BY x.run_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.id, o.clinic_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_due_outbox(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION claim_due_outbox(int) TO clinic_app;
--> statement-breakpoint

-- Opt-out links carry a patient id (HMAC-signed by the API); this finds the clinic only.
CREATE FUNCTION patient_clinic(p_patient_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT p.clinic_id FROM patients p WHERE p.id = p_patient_id $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION patient_clinic(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION patient_clinic(uuid) TO clinic_app;
--> statement-breakpoint

-- "STOP" replies to the shared sender: opt the number out everywhere it is registered, audited
-- per clinic. Returns how many patient records changed.
CREATE FUNCTION sms_opt_out_by_mobile(p_mobile text)
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  changed int;
BEGIN
  WITH updated AS (
    UPDATE patients SET sms_opt_in = false, updated_at = now()
    WHERE mobile = p_mobile AND sms_opt_in
    RETURNING id, clinic_id
  ), logged AS (
    INSERT INTO audit_logs (clinic_id, action, entity_type, entity_id, metadata)
    SELECT clinic_id, 'patient.sms_opt_out', 'patient', id, '{"via":"sms_stop"}'::jsonb FROM updated
    RETURNING 1
  )
  SELECT count(*) INTO changed FROM logged;
  RETURN changed;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sms_opt_out_by_mobile(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION sms_opt_out_by_mobile(text) TO clinic_app;
--> statement-breakpoint

-- New clinics get default notification templates from the platform console.
GRANT INSERT ON notification_templates TO clinic_platform;
--> statement-breakpoint
CREATE POLICY platform_templates ON notification_templates FOR INSERT TO clinic_platform WITH CHECK (true);
