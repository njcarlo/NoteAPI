ALTER TABLE partner_facilities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON partner_facilities TO clinic_app
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
--> statement-breakpoint
ALTER TABLE lab_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON lab_requests TO clinic_app
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
--> statement-breakpoint
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON lab_results TO clinic_app
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
--> statement-breakpoint
-- Partner facilities are deactivated, never deleted (old requests still point at them). Lab
-- requests are part of the medical record, and result files are kept exactly as received.
REVOKE DELETE ON partner_facilities, lab_requests, lab_results FROM clinic_app;
--> statement-breakpoint
REVOKE UPDATE ON lab_results FROM clinic_app;
