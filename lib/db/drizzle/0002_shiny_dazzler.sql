CREATE TABLE "document_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"page_number" integer,
	"category" text DEFAULT 'other' NOT NULL,
	"label" text NOT NULL,
	"value_text" text,
	"numeric_value" real,
	"unit" text,
	"reference_range" text,
	"result_flag" text DEFAULT 'unknown' NOT NULL,
	"confidence" real,
	"source_text" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"corrected_label" text,
	"corrected_value_text" text,
	"corrected_unit" text,
	"corrected_reference_range" text,
	"corrected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_interpretations" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_model" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"error_code" text,
	"sections" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"case_id" integer,
	"storage_key" text NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"page_count" integer,
	"document_type" text DEFAULT 'unknown' NOT NULL,
	"document_type_source" text DEFAULT 'heuristic' NOT NULL,
	"processing_status" text DEFAULT 'uploaded' NOT NULL,
	"extraction_method" text,
	"extraction_error_code" text,
	"checksum" text,
	"text_pages" jsonb,
	"metadata" jsonb,
	"extracted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "document_findings" ADD CONSTRAINT "document_findings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_interpretations" ADD CONSTRAINT "document_interpretations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_interpretations" ADD CONSTRAINT "document_interpretations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_findings_document_id_idx" ON "document_findings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_interpretations_document_id_idx" ON "document_interpretations" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_interpretations_user_id_idx" ON "document_interpretations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_user_id_created_at_idx" ON "documents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_case_id_idx" ON "documents" USING btree ("case_id");