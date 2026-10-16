import { pgTable, serial, text, timestamp, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";
import { predictionsTable } from "./predictions";

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  predictionId: integer("prediction_id").notNull().references(() => predictionsTable.id, { onDelete: "cascade" }),
  reviewerId: integer("reviewer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "reviewed", "accepted", "modified", "rejected", "needs_more_information"] }).notNull().default("pending"),
  originalOutput: jsonb("original_output").notNull(),
  reviewedOutput: jsonb("reviewed_output"),
  rationale: text("rationale"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("reviews_prediction_id_unique").on(table.predictionId), index("reviews_reviewer_id_idx").on(table.reviewerId)]);

export const insertReviewSchema = createInsertSchema(reviews).omit({ id: true, createdAt: true });
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;
