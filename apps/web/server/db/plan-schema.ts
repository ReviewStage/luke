import type { PlanFields } from "@sidecar/hosted/plan-template";
import type { PlanAssumption, PlanCommandResult } from "@sidecar/hosted/plan-wire";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { instant } from "./instant.js";
import { conversations } from "./storage-schema.js";

/**
 * plan-schema.ts -- a named feature plan and its one current document.
 *
 * One row per plan, keyed by a UUID of the service's own and owned by the
 * account that started it: its name and the one
 * document the planning model saves, a Markdown body and the assumptions list
 * beside it, with the template's fields the body was formatted from. A save
 * replaces all three columns in one statement, so there is no
 * earlier document to fall back on and none half-written: a save that failed
 * left the row as it stood. The document is stored as written, like the
 * conversation, readable by an operator and kept the developer's own by the
 * account it is keyed by.
 *
 * The conversation a plan resumes in is the one row it names, attached once
 * the planning model opens it, and a purged conversation leaves the plan
 * standing with none. The row cascades with its account, so deleting an
 * account is still one statement.
 */
export const plan = pgTable(
  "plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The document's Markdown body; empty until the first save. */
    body: text("body").notNull().default(""),
    /** The document's assumptions, each its text. */
    assumptions: jsonb("assumptions")
      .$type<readonly PlanAssumption[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The template's fields the body was formatted from; null until the first save, an untouched template. */
    fields: jsonb("fields").$type<PlanFields>(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    createdAt: instant("created_at").notNull().defaultNow(),
    /** The last save of the document; the start, before any. */
    updatedAt: instant("updated_at").notNull().defaultNow(),
    /** The last time the window opened the plan, which orders the plan list. */
    openedAt: instant("opened_at").notNull().defaultNow(),
  },
  (table) => [
    // The plan list reads one account's plans, most recently opened first.
    index("plan_user_opened").on(table.userId, table.openedAt),
  ],
);

/**
 * One command the planning model asked to run in a plan's folder, which only
 * the developer's Mac knows. The tool inserts it, the Mac claims it
 * (`claimed_at`) and runs it, and posts the `result` the tool is waiting on.
 * Rows go with their plan.
 */
export const planCommand = pgTable("plan_command", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plan.id, { onDelete: "cascade" }),
  command: text("command").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
  claimedAt: instant("claimed_at"),
  /** What the Mac answered: the exit code, stdout, and stderr; null until it does. */
  result: jsonb("result").$type<PlanCommandResult>(),
});
