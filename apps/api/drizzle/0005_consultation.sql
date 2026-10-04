CREATE TABLE "soap_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subjective" text,
	"objective" text,
	"assessment" text,
	"plan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rx_share_tokens" ADD COLUMN "failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "soap_templates" ADD CONSTRAINT "soap_templates_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_templates" ADD CONSTRAINT "soap_templates_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soap_templates_clinic_id_doctor_id_index" ON "soap_templates" USING btree ("clinic_id","doctor_id");