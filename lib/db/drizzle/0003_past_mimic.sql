ALTER TABLE "symptom_assessments" ADD COLUMN "selected_symptoms" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "symptom_assessments" ADD COLUMN "classification" jsonb;