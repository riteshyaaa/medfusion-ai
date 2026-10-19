CREATE TABLE "cardiac_ai_explanations" (
	"id" serial PRIMARY KEY NOT NULL,
	"assessment_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"compared_assessment_id" integer,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text DEFAULT 'cardiac-explanation-v1' NOT NULL,
	"sections" jsonb,
	"status" text NOT NULL,
	"error_code" text,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cardiac_assessments" ADD COLUMN "measurement_source" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "cardiac_assessments" ADD COLUMN "contextual_factors" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "cardiac_ai_explanations" ADD CONSTRAINT "cardiac_ai_explanations_assessment_id_cardiac_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."cardiac_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cardiac_ai_explanations" ADD CONSTRAINT "cardiac_ai_explanations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cardiac_ai_explanations" ADD CONSTRAINT "cardiac_ai_explanations_compared_assessment_id_cardiac_assessments_id_fk" FOREIGN KEY ("compared_assessment_id") REFERENCES "public"."cardiac_assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cardiac_ai_explanations_assessment_idx" ON "cardiac_ai_explanations" USING btree ("assessment_id","created_at");