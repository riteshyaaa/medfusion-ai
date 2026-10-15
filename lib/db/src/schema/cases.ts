import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";
import { patients } from "./patients";

export const cases = pgTable("cases", {
  id: serial("id").primaryKey(),
  caseNumber: text("case_number").notNull().unique(),
  patientId: integer("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  createdById: integer("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedToId: integer("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  type: text("type", { enum: ["skin_analysis", "symptom_assessment", "follow_up", "consultation"] }).notNull(),
  status: text("status", { enum: ["open", "in_review", "closed", "on_hold"] }).notNull().default("open"),
  priority: text("priority", { enum: ["low", "medium", "high", "urgent"] }).notNull().default("medium"),
  chiefComplaint: text("chief_complaint"),
  clinicalNotes: jsonb("clinical_notes").$type<Array<{ timestamp: string; authorId: number; content: string }>>().default([]),
  tags: jsonb("tags").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const insertCaseSchema = createInsertSchema(cases).omit({ id: true, createdAt: true, updatedAt: true, closedAt: true });
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Case = typeof cases.$inferSelect;