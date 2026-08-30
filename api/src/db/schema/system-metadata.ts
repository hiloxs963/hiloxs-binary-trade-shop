import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const systemMetadata = pgTable("system_metadata", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
