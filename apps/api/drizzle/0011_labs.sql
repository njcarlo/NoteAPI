CREATE TYPE "public"."facility_kind" AS ENUM('laboratory', 'imaging', 'hospital', 'clinic');--> statement-breakpoint
CREATE TYPE "public"."lab_request_status" AS ENUM('requested', 'results_in', 'reviewed', 'cancelled');--> statement-breakpoint
CREATE TABLE "lab_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"facility_id" uuid,
	"facility_name" text,
	"tests" text[] NOT NULL,
	"fasting" boolean DEFAULT false NOT NULL,
	"clinical_impression" text,
	"notes" text,
	"status" "lab_request_status" DEFAULT 'requested' NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"lab_request_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "facility_kind" NOT NULL,
	"address" text,
	"contact_number" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_requests" ADD CONSTRAINT "lab_requests_facility_id_partner_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."partner_facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_lab_request_id_lab_requests_id_fk" FOREIGN KEY ("lab_request_id") REFERENCES "public"."lab_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_facilities" ADD CONSTRAINT "partner_facilities_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_requests_clinic_id_status_index" ON "lab_requests" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "lab_requests_clinic_id_patient_id_index" ON "lab_requests" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "lab_requests_clinic_id_doctor_id_status_index" ON "lab_requests" USING btree ("clinic_id","doctor_id","status");--> statement-breakpoint
CREATE INDEX "lab_results_lab_request_id_index" ON "lab_results" USING btree ("lab_request_id");--> statement-breakpoint
CREATE INDEX "partner_facilities_clinic_id_kind_index" ON "partner_facilities" USING btree ("clinic_id","kind");