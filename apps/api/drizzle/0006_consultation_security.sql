ALTER TABLE soap_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON soap_templates TO clinic_app
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
--> statement-breakpoint
-- Prescription share links arrive without tenant context. Returns ids only; the token is hashed.
CREATE FUNCTION rx_share_by_token(p_token_hash text)
RETURNS TABLE (id uuid, clinic_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT s.id, s.clinic_id FROM rx_share_tokens s WHERE s.token_hash = p_token_hash $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rx_share_by_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION rx_share_by_token(text) TO clinic_app;
--> statement-breakpoint
-- A finished visit has exactly one prescription at most; prescriptions are never deleted by the app.
REVOKE DELETE ON prescriptions, prescription_items, visits FROM clinic_app;
