import type { PlanActor } from "@luke/features/task-wire";
import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * plan-template-revision.ts -- an account's plan template history, one revision per row.
 *
 * One row per revision, each the template as it stood after it, kept as a
 * plan's revisions are (`plan-revision.ts`): the developer's saves within a
 * few minutes of one another are one revision each save moves on
 * (`models/plan-template-revisions.ts`), and a restore or a reset is a
 * revision of its own that nothing joins. The template is the account's
 * alone, so a row names the account rather than a task, and goes with it.
 * The first save after history began finds the template the account held
 * and records it first, under `earlier`.
 */
export const planTemplateRevision = pgTable(
  "account_plan_template_revision",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The revision's number within the account's template history, from one. */
    seq: integer("seq").notNull(),
    /** The developer, or `earlier` for the template the account held when its history began. */
    actor: text("actor").$type<PlanActor>().notNull(),
    /** The template's whole text after the revision; null where it is the built-in default, as after a reset. */
    document: text("document"),
    /** How many sections the revision's saves changed, summed over each save it holds. */
    changes: integer("changes").notNull(),
    /** The revision's first save. */
    startedAt: timestamptz("started_at").notNull(),
    /** The revision's latest save. */
    at: timestamptz("at").notNull(),
    /** The revision the developer restored, where this revision is that restore; null for any other. */
    restoredFrom: integer("restored_from"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.seq] })],
);
