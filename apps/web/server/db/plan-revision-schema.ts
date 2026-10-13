import type { PlanActor } from "@sidecar/hosted/plan-wire";
import { integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { codingAgent } from "./coding-agent-schema.js";
import { instant } from "./instant.js";
import { plan } from "./plan-schema.js";

/**
 * plan-revision-schema.ts -- a plan's history, one revision per row.
 *
 * One row per revision, each the plan's content as it
 * stood after the revision, under the writer who made it. Saves the same
 * writer makes one after another, on one call or within a few minutes, are
 * one revision that each save moves on (`hosted/plan-revisions.ts`), so a
 * call is about one row rather than one per pause in the speech. The content
 * is the plan's whole text; a rename is not a revision. A plan from before
 * history starts it with the one revision its
 * first later save found, under `earlier`. The developer restoring an
 * earlier revision writes a revision of its own naming the one it brought
 * back, which nothing joins. Rows go with their plan, and outlive the coding
 * agent that wrote them unnamed.
 */
export const planRevision = pgTable(
  "plan_revision",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "cascade" }),
    /** The revision's number within its plan, from one. */
    seq: integer("seq").notNull(),
    actor: text("actor").$type<PlanActor>().notNull(),
    /** The coding agent that wrote it; null for any other writer, and once the agent's row is gone. */
    agentId: uuid("agent_id").references(() => codingAgent.id, { onDelete: "set null" }),
    /** The call the notetaker wrote it on, as `voice_sessions.live_session_id` names it; null for any other writer. */
    liveSessionId: text("live_session_id"),
    /** The plan's whole text after the revision; every row holds one, and the column is made not null with the drop of the fixed template's columns. */
    document: text("document"),
    /** How many changes the revision's saves made: notes taken, summed over each save it holds. */
    changes: integer("changes").notNull(),
    /** The revision's first save. */
    startedAt: instant("started_at").notNull(),
    /** The revision's latest save. */
    at: instant("at").notNull(),
    /** The revision of the same plan the developer restored, where this revision is that restore; null for any other. */
    restoredFrom: integer("restored_from"),
  },
  (table) => [primaryKey({ columns: [table.planId, table.seq] })],
);
