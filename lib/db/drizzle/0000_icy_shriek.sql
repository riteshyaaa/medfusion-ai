CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event_type" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_number" text NOT NULL,
	"patient_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"assigned_to_id" integer,
	"type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"chief_complaint" text,
	"clinical_notes" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "cases_case_number_unique" UNIQUE("case_number")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text,
	"role" text DEFAULT 'user' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date,
	"sex" text,
	"phone" text,
	"email" text,
	"address" jsonb,
	"medical_history" jsonb DEFAULT '[]'::jsonb,
	"allergies" jsonb DEFAULT '[]'::jsonb,
	"medications" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"case_id" integer,
	"storage_key" text NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"checksum" text,
	"metadata" jsonb,
	"is_processed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"disease" text NOT NULL,
	"confidence" real NOT NULL,
	"description" text NOT NULL,
	"severity" text NOT NULL,
	"recommendations" jsonb NOT NULL,
	"differential_diagnoses" jsonb NOT NULL,
	"preprocessing_steps" jsonb NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"model_id" text,
	"model_version" text,
	"score_semantics" text DEFAULT 'raw_model_score' NOT NULL,
	"preprocessing_version" text,
	"upload_id" integer,
	"image_base64" text,
	"file_name" text,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symptom_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"case_id" integer,
	"primary_symptom" text NOT NULL,
	"symptom_category" text NOT NULL,
	"onset" text,
	"duration" text,
	"severity" text,
	"progression" text,
	"associated_symptoms" jsonb DEFAULT '[]'::jsonb,
	"medical_history" jsonb DEFAULT '[]'::jsonb,
	"medications" jsonb DEFAULT '[]'::jsonb,
	"allergies" jsonb DEFAULT '[]'::jsonb,
	"red_flags_triggered" jsonb DEFAULT '[]'::jsonb,
	"urgency_level" text NOT NULL,
	"guidance" jsonb,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"prediction_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"original_output" jsonb NOT NULL,
	"reviewed_output" jsonb,
	"rationale" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_number" text NOT NULL,
	"case_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"reviewer_id" integer,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"prediction_ids" jsonb DEFAULT '[]'::jsonb,
	"reviewed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_report_number_unique" UNIQUE("report_number")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD CONSTRAINT "symptom_assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD CONSTRAINT "symptom_assessments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_user_id_created_at_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "cases_owner_created_at_idx" ON "cases" USING btree ("created_by_id","created_at");--> statement-breakpoint
CREATE INDEX "cases_patient_id_idx" ON "cases" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "patients_user_id_created_at_idx" ON "patients" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "uploads_user_id_created_at_idx" ON "uploads" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "predictions_user_id_created_at_idx" ON "predictions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "symptom_assessments_user_id_created_at_idx" ON "symptom_assessments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_prediction_id_unique" ON "reviews" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "reviews_reviewer_id_idx" ON "reviews" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "reports_author_id_created_at_idx" ON "reports" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_case_id_idx" ON "reports" USING btree ("case_id");