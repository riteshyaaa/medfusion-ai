ALTER TABLE "cardiac_assessments" ADD COLUMN "ai_assessment" jsonb;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "ai_assessment" jsonb;