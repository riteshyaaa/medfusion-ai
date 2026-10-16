import { pgTable, serial, text, timestamp, integer, jsonb, real, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";
import { cases } from "./cases";

export const cardiacAssessments = pgTable("cardiac_assessments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  caseId: integer("case_id").references(() => cases.id, { onDelete: "set null" }),
  inputs: jsonb("inputs").$type<Record<string, string | number>>().notNull(),
  riskScore: real("risk_score"),
  aboveThreshold: boolean("above_threshold"),
  label: text("label", { enum: ["disease", "no_disease"] }),
  status: text("status", { enum: ["research_only", "model_unavailable"] }).notNull(),
  modelId: text("model_id"),
  modelVersion: text("model_version"),
  threshold: real("threshold"),
  topFactors: jsonb("top_factors").$type<Array<{ feature: string; description: string; contribution: number; unit: string | null }>>().default([]),
  notice: text("notice").notNull(),
  diagnosticLimitations: jsonb("diagnostic_limitations").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("cardiac_assessments_user_id_created_at_idx").on(table.userId, table.createdAt)]);

export const insertCardiacAssessmentSchema = createInsertSchema(cardiacAssessments).omit({ id: true, createdAt: true, userId: true });
export type InsertCardiacAssessment = z.infer<typeof insertCardiacAssessmentSchema>;
export type CardiacAssessment = typeof cardiacAssessments.$inferSelect;
