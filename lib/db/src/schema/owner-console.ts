import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const ownerConsoleRecordsTable = pgTable(
  "owner_console_records",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    isDevelopmentFixture: boolean("is_development_fixture")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("owner_console_records_kind_idx").on(table.kind)],
);

export const insertOwnerConsoleRecordSchema = createInsertSchema(
  ownerConsoleRecordsTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertOwnerConsoleRecord = z.infer<
  typeof insertOwnerConsoleRecordSchema
>;
export type OwnerConsoleRecord = typeof ownerConsoleRecordsTable.$inferSelect;

export const ownerConsoleSettingsTable = pgTable("owner_console_settings", {
  id: smallint("id").primaryKey().default(1),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertOwnerConsoleSettingsSchema = createInsertSchema(
  ownerConsoleSettingsTable,
).omit({ updatedAt: true });
export type InsertOwnerConsoleSettings = z.infer<
  typeof insertOwnerConsoleSettingsSchema
>;
export type OwnerConsoleSettings =
  typeof ownerConsoleSettingsTable.$inferSelect;

export const ownerConsoleAnswersTable = pgTable(
  "owner_console_answers",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id").notNull(),
    answer: text("answer").notNull(),
    scope: text("scope").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    publicUsePermission: boolean("public_use_permission").notNull(),
    status: text("status").notNull().default("pending_review"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("owner_console_answers_question_unique_idx").on(
      table.questionId,
    ),
  ],
);

export const insertOwnerConsoleAnswerSchema = createInsertSchema(
  ownerConsoleAnswersTable,
).omit({ createdAt: true });
export type InsertOwnerConsoleAnswer = z.infer<
  typeof insertOwnerConsoleAnswerSchema
>;
export type OwnerConsoleAnswer = typeof ownerConsoleAnswersTable.$inferSelect;