import type { PlanAssumption } from "@sidecar/hosted";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { instant } from "./instant.js";
import { conversations } from "./storage-schema.js";

/**
 * plan-schema.ts -- a named feature plan and its one current document.
 *
 * One row per plan, keyed by a UUID of the service's own and owned by the
 * account that started it: its name, the GitHub repository it plans against
 * with the default branch and the commit that branch stood at when it started
 * (fixed for the plan's life, and not a version of the plan), and the one
 * document the planning model saves, a Markdown body and the assumptions list
 * beside it. A save replaces both columns in one statement, so there is no
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
    repositoryOwner: text("repository_owner").notNull(),
    repositoryName: text("repository_name").notNull(),
    repositoryBranch: text("repository_branch").notNull(),
    repositoryCommit: text("repository_commit").notNull(),
    /** The document's Markdown body; empty until the first save. */
    body: text("body").notNull().default(""),
    /** The document's assumptions, each its text and whether it was confirmed. */
    assumptions: jsonb("assumptions")
      .$type<readonly PlanAssumption[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
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
