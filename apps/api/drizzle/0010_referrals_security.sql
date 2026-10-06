ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON referrals TO clinic_app
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
--> statement-breakpoint
-- Referrals are part of the medical record: cancelled or declined, never deleted.
REVOKE DELETE ON referrals FROM clinic_app;
--> statement-breakpoint

-- Keeps a booked referral in step with its appointment, whichever path changes the appointment
-- (front desk, doctor, or the patient's cancel link): finished → completed; cancelled or no-show →
-- back to pending so the front desk books it again.
CREATE FUNCTION sync_referral_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'done' THEN
    UPDATE referrals SET status = 'completed', updated_at = now()
    WHERE scheduled_appointment_id = NEW.id AND status = 'scheduled';
  ELSIF NEW.status IN ('cancelled', 'no_show') THEN
    UPDATE referrals SET status = 'pending', scheduled_appointment_id = NULL, updated_at = now()
    WHERE scheduled_appointment_id = NEW.id AND status = 'scheduled';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER appointments_sync_referral
AFTER UPDATE OF status ON appointments
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION sync_referral_status();
