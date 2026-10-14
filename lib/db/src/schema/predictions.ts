import { pgTable, serial, text, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const predictionsTable = pgTable("predictions", {
  id: serial("id").primaryKey(),
  disease: text("disease").notNull(),
  confidence: real("confidence").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull(),
  recommendations: jsonb("recommendations").$type<string[]>().notNull(),
  differentialDiagnoses: jsonb("differential_diagnoses").$type<{ disease: string; confidence: number }[]>().notNull(),
  preprocessingSteps: jsonb("preprocessing_steps").$type<string[]>().notNull(),
  imageBase64: text("image_base64"),
  fileName: text("file_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({ id: true, createdAt: true });
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type Prediction = typeof predictionsTable.$inferSelect;
