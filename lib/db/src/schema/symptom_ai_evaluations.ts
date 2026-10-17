import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { symptomAssessments } from "./symptom_assessments";

export const symptomAiEvaluationsTable = pgTable("symptom_ai_evaluations", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").notNull().references(() => symptomAssessments.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull().default("symptom-eval-v1"),
  result: jsonb("result"),
  status: text("status", { enum: ["completed", "failed"] }).notNull(),
  errorCode: text("error_code"),
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  consentEventId: text("consent_event_id"),
  reviewStatus: text("review_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("symptom_ai_evaluations_assessment_idx").on(table.assessmentId, table.createdAt)]);

export const symptomAiEvaluations = symptomAiEvaluationsTable;
export type SymptomAiEvaluation = typeof symptomAiEvaluationsTable.$inferSelect;
