import type {
  PlanCommentActor,
  PlanCommentEntryKind,
  PlanCommentScope,
  PlanCommentStatus,
} from "@luke/features/plan-comment-wire";
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { codingAgent } from "./coding-agent.js";
import { task } from "./plan.js";

/**
 * plan-comment.ts -- comments on a task's plan: a thread anchored to words of the plan's text, and each of its entries.
 *
 * A thread's anchor is kept here as offsets into the plan's Markdown
 * (`task.document`) rather than written into the text, so every reader of the
 * text reads none of it; the plan's one save moves every anchor with its
 * words (`@luke/features/plan-comment-anchor`), and nulls both offsets of an
 * anchor whose every word it deleted, the thread keeping its quote. The
 * section is the heading the words stood under when the anchor last moved.
 * A thread is the plan's, shared by every member of its workspace, and goes
 * with the plan.
 *
 * An entry is a comment, or a line of what happened to the thread: an ask of
 * Luke or a coding agent, a resolve, a reopen. Who wrote it is its actor: a
 * member, Luke, or a coding agent, with the member whose turn it was kept
 * beside Luke and an agent; an entry stays when its member's account or its
 * agent is gone, naming nobody. The key a member's client wrote it under is
 * unique on the plan, so a write sent again after a lost answer is taken
 * once.
 */
export const planCommentThread = pgTable(
  "plan_comment_thread",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("plan_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    scope: text("scope").$type<PlanCommentScope>().notNull(),
    /** The words the thread was anchored to, as they stood when it was started. */
    quote: text("quote").notNull(),
    /** Where the words stand in the plan's text; both null once every one of them was deleted. */
    anchorFrom: integer("anchor_from"),
    anchorTo: integer("anchor_to"),
    /** The heading of the section the words stood in when the anchor last moved; empty before the first heading. */
    section: text("section").notNull(),
    status: text("status").$type<PlanCommentStatus>().notNull(),
    /** Moved on by every change of the thread, which a reader's cursor digests. */
    revision: integer("revision").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [index("plan_comment_thread_plan_created").on(table.taskId, table.createdAt)],
);

export const planComment = pgTable(
  "plan_comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => planCommentThread.id, { onDelete: "cascade" }),
    /** The thread's plan, kept on the row so a plan's entries are read by one index. */
    taskId: uuid("plan_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    /** Where the entry stands in its thread: the thread's revision its write moved it to. */
    seq: integer("seq").notNull(),
    kind: text("kind").$type<PlanCommentEntryKind>().notNull(),
    actor: text("actor").$type<PlanCommentActor>().notNull(),
    /** The member who wrote it, or whose turn Luke or the agent wrote it on; null once their account is gone. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** The coding agent that wrote it; null for a member's or Luke's, and once the agent is gone. */
    agentId: uuid("agent_id").references(() => codingAgent.id, { onDelete: "set null" }),
    /** A comment's words; null for a line of what happened. */
    words: text("words"),
    /** Who an ask sent the thread to, Luke or a coding agent; null for any other entry. */
    askedActor: text("asked_actor").$type<PlanCommentActor>(),
    askedAgentId: uuid("asked_agent_id").references(() => codingAgent.id, {
      onDelete: "set null",
    }),
    /** The key the member's client wrote it under; null for an agent's. */
    clientKey: text("client_key"),
    createdAt: timestamptz("created_at").notNull(),
    /** When a comment's words were last edited; null while they stand as written. */
    editedAt: timestamptz("edited_at"),
  },
  (table) => [
    index("plan_comment_thread_seq").on(table.threadId, table.seq),
    index("plan_comment_plan").on(table.taskId),
    uniqueIndex("plan_comment_client_key")
      .on(table.taskId, table.clientKey)
      .where(sql`${table.clientKey} is not null`),
  ],
);
