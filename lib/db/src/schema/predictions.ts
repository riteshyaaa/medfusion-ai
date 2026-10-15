import { pgTable, serial, text, real, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";

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
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const predictions = predictionsTable;

export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({ id: true, createdAt: true, userId: true });
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type Prediction = typeof predictionsTable.$inferSelect;