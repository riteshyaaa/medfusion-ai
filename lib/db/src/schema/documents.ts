import { pgTable, serial, text, timestamp, integer, jsonb, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";
import { cases } from "./cases";

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  caseId: integer("case_id").references(() => cases.id, { onDelete: "set null" }),
  storageKey: text("storage_key").notNull().unique(),
  originalFileName: text("original_file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  pageCount: integer("page_count"),
  documentType: text("document_type", { enum: ["lab_report", "medical_summary", "discharge_summary", "prescription", "radiology_report", "other", "unknown"] }).notNull().default("unknown"),
  documentTypeSource: text("document_type_source", { enum: ["heuristic", "user", "provider"] }).notNull().default("heuristic"),
  processingStatus: text("processing_status", { enum: ["uploaded", "processing", "extracted", "needs_review", "ocr_unavailable", "failed", "unsupported"] }).notNull().default("uploaded"),
  extractionMethod: text("extraction_method", { enum: ["pdf_text", "pdf_embedded_image_ocr", "image_ocr", "none"] }),
  extractionErrorCode: text("extraction_error_code"),
  checksum: text("checksum"),
  textPages: jsonb("text_pages").$type<Array<{ page: number; text: string; method: "text" | "ocr" }>>(),
  metadata: jsonb("metadata").$type<{ format?: string; ocrLanguage?: string; importWarnings?: string[]; extractionNotes?: string[] }>(),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("documents_user_id_created_at_idx").on(table.userId, table.createdAt), index("documents_case_id_idx").on(table.caseId)]);

export const documentFindings = pgTable("document_findings", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number"),
  category: text("category", { enum: ["lab_result", "vital_sign", "medication", "diagnosis", "impression", "other"] }).notNull().default("other"),
  label: text("label").notNull(),
  valueText: text("value_text"),
  numericValue: real("numeric_value"),
  unit: text("unit"),
  referenceRange: text("reference_range"),
  resultFlag: text("result_flag", { enum: ["normal", "high", "low", "abnormal", "unknown"] }).notNull().default("unknown"),
  confidence: real("confidence"),
  sourceText: text("source_text").notNull(),
  status: text("status", { enum: ["candidate", "confirmed", "corrected", "rejected"] }).notNull().default("candidate"),
  correctedLabel: text("corrected_label"),
  correctedValueText: text("corrected_value_text"),
  correctedUnit: text("corrected_unit"),
  correctedReferenceRange: text("corrected_reference_range"),
  correctedAt: timestamp("corrected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("document_findings_document_id_idx").on(table.documentId)]);

export const documentInterpretations = pgTable("document_interpretations", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerModel: text("provider_model").notNull(),
  status: text("status", { enum: ["completed", "failed"] }).notNull().default("completed"),
  errorCode: text("error_code"),
  sections: jsonb("sections").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("document_interpretations_document_id_idx").on(table.documentId), index("document_interpretations_user_id_idx").on(table.userId)]);

export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type DocumentRecord = typeof documents.$inferSelect;
export type DocumentFindingRecord = typeof documentFindings.$inferSelect;
export type DocumentInterpretationRecord = typeof documentInterpretations.$inferSelect;
