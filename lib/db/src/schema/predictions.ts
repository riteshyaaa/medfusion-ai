import { pgTable, serial, text, real, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";
import { uploads } from "./uploads";

export const predictionsTable = pgTable("predictions", {
  id: serial("id").primaryKey(),
  disease: text("disease").notNull(),
  confidence: real("confidence").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull(),
  recommendations: jsonb("recommendations").$type<string[]>().notNull(),
  differentialDiagnoses: jsonb("differential_diagnoses").$type<{ disease: string; confidence: number }[]>().notNull(),
  preprocessingSteps: jsonb("preprocessing_steps").$type<string[]>().notNull(),
  status: text("status").notNull().default("legacy_unverified"),
  modelId: text("model_id"),
  modelVersion: text("model_version"),
  scoreSemantics: text("score_semantics").notNull().default("unverified"),
  preprocessingVersion: text("preprocessing_version"),
  aiAssessment: jsonb("ai_assessment").$type<{
    provider: string;
    model: string;
    observations: string[];
    possibleConditions: Array<{ name: string; reason: string }>;
    uncertainty: string;
    severity: "mild" | "moderate" | "severe" | "uncertain";
    urgency: "routine" | "prompt" | "urgent" | "emergency" | "uncertain";
    nextSteps: string[];
    consultClinicianWhen: string[];
    preprocessingSteps: string[];
  } | null>(),
  uploadId: integer("upload_id").references(() => uploads.id, { onDelete: "set null" }),
  // Retained for compatibility with any pre-migration database. New code never writes or returns this column.
  imageBase64: text("image_base64"),
  fileName: text("file_name"),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("predictions_user_id_created_at_idx").on(table.userId, table.createdAt)]);

export const predictions = predictionsTable;

export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({ id: true, createdAt: true, userId: true });
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type Prediction = typeof predictionsTable.$inferSelect;
