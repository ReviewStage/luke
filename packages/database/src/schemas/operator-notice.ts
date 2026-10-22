import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { OperatorNoticeKind } from "../storage-vocabulary.js";
import { timestamptz } from "./_helpers.js";
import { codingAgent } from "./coding-agent.js";
import { task } from "./task.js";

/**
 * operator-notice.ts -- what an operator is told of its member's agents on its next turn, and when a failure last woke it.
 *
 * A member's operator (`coding_agent.kind = operator`) watches the member's
 * own agents of its workspace through notices rather than one wake per
 * event: a turn settled, a turn failed or abandoned, a pull request merged
 * or closed, a new ask in the member's inbox. One row per event kind and
 * agent while unread: a repeat event moves `at` on the unread row rather
 * than adding one, which the partial unique index holds and the store's
 * upsert rides. The operator's desk hands the unread rows on its next turn
 * and stamps `read_at` once handed, after which the next event opens a
 * fresh row. The rows go with the operator and with the agent.
 */
export const operatorNotice = pgTable(
  "operator_notice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    /** What happened (`OPERATOR_NOTICE_KIND`). */
    kind: text("kind").$type<OperatorNoticeKind>().notNull(),
    /** The member's agent it happened to. */
    agentId: uuid("agent_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    /** The agent's task as the event was written; null for an agent with none. */
    taskId: uuid("task_id").references(() => task.id, { onDelete: "set null" }),
    /** When the latest event this row stands for happened: a repeat while unread moves it. */
    at: timestamptz("at").notNull(),
    /** When the operator's desk handed the row; null while unread. */
    readAt: timestamptz("read_at"),
  },
  (table) => [
    // One unread notice per operator, agent, and kind, which a repeat event's upsert lands on.
    uniqueIndex("operator_notice_unread")
      .on(table.operatorId, table.agentId, table.kind)
      .where(sql`${table.readAt} is null`),
    // The desk reads an operator's unread notices newest first.
    index("operator_notice_operator_at").on(table.operatorId, table.at),
    // The cascade from a deleted agent finds its notices.
    index("operator_notice_agent").on(table.agentId),
  ],
);

/**
 * When a failure of one of the member's agents last woke the operator: one
 * row per operator and agent, stamped only once the wake landed, so a
 * failure within the hour after it wakes nothing and a wake that failed
 * burns nothing (`maintenance/operator-wake-sweep.ts`). The rows go with
 * the operator and with the agent.
 */
export const operatorWake = pgTable(
  "operator_wake",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    /** When the latest wake for this agent's failure landed. */
    wokenAt: timestamptz("woken_at").notNull(),
  },
  (table) => [
    uniqueIndex("operator_wake_operator_agent").on(table.operatorId, table.agentId),
    // The cascade from a deleted agent finds its wakes.
    index("operator_wake_agent").on(table.agentId),
  ],
);
