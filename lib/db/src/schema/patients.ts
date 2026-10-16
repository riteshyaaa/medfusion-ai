import { pgTable, serial, text, timestamp, integer, date, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";

export const patients = pgTable("patients", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dateOfBirth: date("date_of_birth"),
  sex: text("sex", { enum: ["male", "female", "other"] }),
  phone: text("phone"),
  email: text("email"),
  address: jsonb("address").$type<{ street?: string; city?: string; state?: string; postalCode?: string; country?: string }>(),
  medicalHistory: jsonb("medical_history").$type<string[]>().default([]),
  allergies: jsonb("allergies").$type<string[]>().default([]),
  medications: jsonb("medications").$type<string[]>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [index("patients_user_id_created_at_idx").on(table.userId, table.createdAt)]);

export const insertPatientSchema = createInsertSchema(patients).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patients.$inferSelect;
