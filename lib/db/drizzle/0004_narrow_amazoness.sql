CREATE TABLE "cardiac_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"case_id" integer,
	"inputs" jsonb NOT NULL,
	"risk_score" real,
	"above_threshold" boolean,
	"label" text,
	"status" text NOT NULL,
	"model_id" text,
	"model_version" text,
	"threshold" real,
	"top_factors" jsonb DEFAULT '[]'::jsonb,
	"notice" text NOT NULL,
	"diagnostic_limitations" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cardiac_assessments" ADD CONSTRAINT "cardiac_assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cardiac_assessments" ADD CONSTRAINT "cardiac_assessments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cardiac_assessments_user_id_created_at_idx" ON "cardiac_assessments" USING btree ("user_id","created_at");