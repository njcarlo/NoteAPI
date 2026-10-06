CREATE TYPE "public"."referral_status" AS ENUM('pending', 'scheduled', 'completed', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."referral_urgency" AS ENUM('routine', 'urgent', 'emergency');--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"from_doctor_id" uuid NOT NULL,
	"specialty" text NOT NULL,
	"to_doctor_id" uuid,
	"external_doctor" text,
	"external_facility" text,
	"urgency" "referral_urgency" DEFAULT 'routine' NOT NULL,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"clinical_summary" text,
	"response_note" text,
	"scheduled_appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_scheduledAppointmentId_unique" UNIQUE("scheduled_appointment_id")
);
--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_from_doctor_id_users_id_fk" FOREIGN KEY ("from_doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_to_doctor_id_users_id_fk" FOREIGN KEY ("to_doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_scheduled_appointment_id_appointments_id_fk" FOREIGN KEY ("scheduled_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referrals_clinic_id_to_doctor_id_status_index" ON "referrals" USING btree ("clinic_id","to_doctor_id","status");--> statement-breakpoint
CREATE INDEX "referrals_clinic_id_from_doctor_id_index" ON "referrals" USING btree ("clinic_id","from_doctor_id");--> statement-breakpoint
CREATE INDEX "referrals_clinic_id_patient_id_index" ON "referrals" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "referrals_visit_id_index" ON "referrals" USING btree ("visit_id");