import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";

export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  action: text("action").notNull(),
  outcome: text("outcome", { enum: ["success", "failure", "error"] }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("audit_events_user_id_created_at_idx").on(table.userId, table.createdAt)]);

export const insertAuditEventSchema = createInsertSchema(auditEvents).omit({ id: true, createdAt: true });
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEvents.$inferSelect;
