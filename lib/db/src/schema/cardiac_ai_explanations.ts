import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { cardiacAssessments } from "./cardiac_assessments";

export const cardiacAiExplanationsTable = pgTable("cardiac_ai_explanations", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").notNull().references(() => cardiacAssessments.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  comparedAssessmentId: integer("compared_assessment_id").references(() => cardiacAssessments.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull().default("cardiac-explanation-v1"),
  sections: jsonb("sections"),
  status: text("status", { enum: ["completed", "failed"] }).notNull(),
  errorCode: text("error_code"),
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("cardiac_ai_explanations_assessment_idx").on(table.assessmentId, table.createdAt)]);

export const cardiacAiExplanations = cardiacAiExplanationsTable;
export type CardiacAiExplanation = typeof cardiacAiExplanationsTable.$inferSelect;
