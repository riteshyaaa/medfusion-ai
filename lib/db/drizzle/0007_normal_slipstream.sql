ALTER TABLE "symptom_assessments" ADD COLUMN "age_group" text;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD COLUMN "factors_that_help" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD COLUMN "factors_that_worsen" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD COLUMN "previous_episodes" text;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD COLUMN "additional_notes" text;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD COLUMN "questionnaire_answers" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD COLUMN "questionnaire_version" text;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD COLUMN "input_schema_version" text;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD COLUMN "normalized_input" jsonb;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD COLUMN "rule_set_version" text;