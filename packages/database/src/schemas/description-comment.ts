import type {
  DescriptionCommentActor,
  DescriptionCommentEntryKind,
  DescriptionCommentScope,
  DescriptionCommentStatus,
} from "@repo/features/description-comment-wire";
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";
import { task } from "./task.js";

/**
 * description-comment.ts -- comments on a task's plan: a thread anchored to words of the plan's text, and each of its entries.
 *
 * A thread's anchor is kept here as offsets into the plan's Markdown
 * (`task.document`) rather than written into the text, so every reader of the
 * text reads none of it; the plan's one save moves every anchor with its
 * words (`@repo/features/description-comment-anchor`), and nulls both offsets of an
 * anchor whose every word it deleted, the thread keeping its quote. The
 * section is the heading the words stood under when the anchor last moved.
 * A thread is the plan's, shared by every member of its workspace, and goes
 * with the plan.
 *
 * A thread may stand on one of the task's pages instead (`task-page.ts`),
 * which `page_id` names, a page having no row of its own: on the version
 * `page_version` names, and on the element of it `page_element` names by
 * its path, or on the whole page where none is named. Such a thread has no
 * offsets, its quote the element's words or the page's title, and goes with
 * the task as the page's versions do.
 *
 * An entry is a comment, or a line of what happened to the thread: an ask of
 * the per-task assistant or a coding agent, a resolve, a reopen. Who wrote it
 * is its actor: a member, the per-task assistant, or a coding agent, with the
 * member whose turn it was kept beside the per-task assistant and an agent; an
 * entry stays when its member's account or its agent is gone, naming nobody.
 * The key a member's client wrote it under is unique on the plan, so a write
 * sent again after a lost answer is taken once.
 */
export const descriptionCommentThread = pgTable(
  "description_comment_thread",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    scope: text("scope").$type<DescriptionCommentScope>().notNull(),
    /** The words the thread was anchored to, as they stood when it was started. */
    quote: text("quote").notNull(),
    /** Where the words stand in the plan's text; both null once every one of them was deleted. */
    anchorFrom: integer("anchor_from"),
    anchorTo: integer("anchor_to"),
    /** The heading of the section the words stood in when the anchor last moved; empty before the first heading. */
    section: text("section").notNull(),
    /** The page of the task the thread is on, the same on each of its versions; null for a thread on the plan. */
    pageId: uuid("page_id"),
    /** The version of the page the thread was left on; null for a thread on the plan. */
    pageVersion: integer("page_version"),
    /** The path of the element of that version the thread is on; null for the whole page, and on the plan. */
    pageElement: text("page_element"),
    status: text("status").$type<DescriptionCommentStatus>().notNull(),
    /** Moved on by every change of the thread, which a reader's cursor digests. */
    revision: integer("revision").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("description_comment_thread_task_created").on(table.taskId, table.createdAt),
    // A page and its version stand together or not at all.
    check(
      "description_comment_thread_page",
      sql`(${table.pageId} is null) = (${table.pageVersion} is null) and (${table.pageElement} is null or ${table.pageId} is not null)`,
    ),
  ],
);

export const descriptionComment = pgTable(
  "description_comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => descriptionCommentThread.id, { onDelete: "cascade" }),
    /** The thread's plan, kept on the row so a plan's entries are read by one index. */
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    /** Where the entry stands in its thread: the thread's revision its write moved it to. */
    seq: integer("seq").notNull(),
    kind: text("kind").$type<DescriptionCommentEntryKind>().notNull(),
    actor: text("actor").$type<DescriptionCommentActor>().notNull(),
    /** The member who wrote it, or whose turn the per-task assistant or the agent wrote it on; null once their account is gone. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    /** The coding agent that wrote it; null for a member's or the per-task assistant's, and once the agent is gone. */
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "set null" }),
    /** A comment's words; null for a line of what happened. */
    words: text("words"),
    /** Who an ask sent the thread to, the per-task assistant or a coding agent; null for any other entry. */
    askedActor: text("asked_actor").$type<DescriptionCommentActor>(),
    askedAgentId: uuid("asked_agent_id").references(() => agentTable.id, {
      onDelete: "set null",
    }),
    /** The key the member's client wrote it under; null for an agent's. */
    clientKey: text("client_key"),
    createdAt: timestamptz("created_at").notNull(),
    /** When a comment's words were last edited; null while they stand as written. */
    editedAt: timestamptz("edited_at"),
  },
  (table) => [
    index("description_comment_thread_seq").on(table.threadId, table.seq),
    index("description_comment_task").on(table.taskId),
    uniqueIndex("description_comment_client_key")
      .on(table.taskId, table.clientKey)
      .where(sql`${table.clientKey} is not null`),
  ],
);
