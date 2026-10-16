ALTER TABLE "predictions" ALTER COLUMN "status" SET DEFAULT 'legacy_unverified';--> statement-breakpoint
ALTER TABLE "predictions" ALTER COLUMN "score_semantics" SET DEFAULT 'unverified';