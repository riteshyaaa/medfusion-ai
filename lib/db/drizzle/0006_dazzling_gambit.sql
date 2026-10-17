CREATE TABLE "symptom_ai_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"assessment_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text DEFAULT 'symptom-eval-v1' NOT NULL,
	"result" jsonb,
	"status" text NOT NULL,
	"error_code" text,
	"consent_at" timestamp with time zone NOT NULL,
	"consent_event_id" text,
	"review_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "symptom_ai_evaluations" ADD CONSTRAINT "symptom_ai_evaluations_assessment_id_symptom_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."symptom_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symptom_ai_evaluations" ADD CONSTRAINT "symptom_ai_evaluations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "symptom_ai_evaluations_assessment_idx" ON "symptom_ai_evaluations" USING btree ("assessment_id","created_at");