ALTER TABLE "document_findings" ADD COLUMN "ambiguous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document_findings" ADD COLUMN "normalized_label" text;--> statement-breakpoint
ALTER TABLE "document_interpretations" ADD COLUMN "prompt_version" text;