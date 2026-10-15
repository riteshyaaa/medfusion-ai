import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";
import { cases } from "./cases";

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  reportNumber: text("report_number").notNull().unique(),
  caseId: integer("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reviewerId: integer("reviewer_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  type: text("type", { enum: ["skin_analysis", "symptom_assessment", "comprehensive", "follow_up"] }).notNull(),
  status: text("status", { enum: ["draft", "finalized", "archived", "amended"] }).notNull().default("draft"),
  content: jsonb("content").notNull(),
  predictionIds: jsonb("prediction_ids").$type<number[]>().default([]),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertReportSchema = createInsertSchema(reports).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reports.$inferSelect;