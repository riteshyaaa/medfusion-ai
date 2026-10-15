import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";
import { cases } from "./cases";

export const symptomAssessments = pgTable("symptom_assessments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  caseId: integer("case_id").references(() => cases.id, { onDelete: "set null" }),
  primarySymptom: text("primary_symptom").notNull(),
  symptomCategory: text("symptom_category", { enum: ["skin", "general", "neurological", "cardiovascular", "respiratory", "gastrointestinal", "musculoskeletal", "psychiatric", "other"] }).notNull(),
  onset: text("onset"),
  duration: text("duration"),
  severity: text("severity", { enum: ["mild", "moderate", "severe"] }),
  progression: text("progression", { enum: ["improving", "stable", "worsening", "fluctuating"] }),
  associatedSymptoms: jsonb("associated_symptoms").$type<string[]>().default([]),
  medicalHistory: jsonb("medical_history").$type<string[]>().default([]),
  medications: jsonb("medications").$type<string[]>().default([]),
  allergies: jsonb("allergies").$type<string[]>().default([]),
  redFlagsTriggered: jsonb("red_flags_triggered").$type<string[]>().default([]),
  urgencyLevel: text("urgency_level", { enum: ["emergency", "urgent", "routine", "self_care"] }).notNull(),
  guidance: jsonb("guidance").$type<{ recommendations: string[]; disclaimer: string }>(),
  status: text("status", { enum: ["draft", "completed", "reviewed"] }).notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSymptomAssessmentSchema = createInsertSchema(symptomAssessments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSymptomAssessment = z.infer<typeof insertSymptomAssessmentSchema>;
export type SymptomAssessment = typeof symptomAssessments.$inferSelect;