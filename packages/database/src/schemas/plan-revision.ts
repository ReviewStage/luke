import type { PlanActor, Rollout } from "@sidecar/hosted/plan-wire";
import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { codingAgent } from "./coding-agent.js";
import { plan } from "./plan.js";

/**
 * plan-revision.ts -- a plan's history, one revision per row.
 *
 * One row per revision, each the plan's content as it
 * stood after the revision, under the writer who made it. Saves the same
 * writer makes one after another, on one call or within a few minutes, are
 * one revision that each save moves on (`models/plan-revisions.ts`), so a
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
    /** The plan's whole text after the revision. */
    document: text("document").notNull(),
    /** The plan's rollout after the revision. */
    rollout: jsonb("rollout").$type<Rollout>().notNull().default(sql`'[]'::jsonb`),
    /** How many changes the revision's saves made: notes taken, summed over each save it holds. */
    changes: integer("changes").notNull(),
    /** The revision's first save. */
    startedAt: timestamptz("started_at").notNull(),
    /** The revision's latest save. */
    at: timestamptz("at").notNull(),
    /** The revision of the same plan the developer restored, where this revision is that restore; null for any other. */
    restoredFrom: integer("restored_from"),
  },
  (table) => [primaryKey({ columns: [table.planId, table.seq] })],
);
