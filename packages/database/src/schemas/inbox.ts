import {
  INBOX_STATUS,
  type InboxBlock,
  type InboxReply,
  type InboxResponse,
  type InboxStatus,
} from "@luke/features/inbox-wire";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";
import { codingAgent } from "./coding-agent.js";
import { inboxMessage } from "./inbox-message.js";
import { task } from "./task.js";

/**
 * inbox.ts -- one item of the developer's inbox: something a coding agent needs of the developer, posted under a key of the agent's own.
 *
 * The agent names the item by its key, unique per agent, so posting under
 * the same key again is a write of this row rather than a second one: the
 * revision moves on, the item opens again, and what it asked replaces what
 * it asked before. The title, the blocks of context, and the response the
 * item asks for are what the agent posted last, the blocks and the response
 * as the wire's own JSON (`@luke/features/inbox-wire`), so a block type
 * added later is a member of that JSON rather than a column; `needs_reply`
 * is whether the agent is to hear the answer as a message. The status is
 * open until a member answers it, which writes the answer, the member, and
 * the key the client sent it under, so an answer sent again after a lost
 * reply is taken once, or until it is closed: by the agent, which writes
 * why, or by a member without an answer, which writes the member. The task is
 * the agent's, kept on the row so a task's inbox is read by one index, and
 * the account's open items are read by another. A message on the item's
 * thread (`inbox-message.ts`) moves when it last changed and never when it
 * was settled. From version 5 an agent's message on the thread may carry
 * an ask, and the one that waits on an answer is named here; the title,
 * blocks, response, and `needs_reply` stay written beside it for a reader
 * from before version 5. The row goes with its
 * account, its task, and its agent alike. The columns
 * the fixed kinds stood in, `kind`, `details`, `options`, and
 * `recommended`, are declared no longer: the database still holds them,
 * kept in step by the trigger `20261007104640_inbox_item_blocks` installed,
 * until a contract migration drops them both.
 */
export const inboxItem = pgTable(
  "inbox_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The agent's task; null for an agent with no task. */
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    /** The agent's workspace. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    /** The agent's own name for the item, the same each time it means the same item. */
    key: text("key").notNull(),
    /** Moved on by every change of the agent's, which an answer names so it answers the item it was shown. */
    revision: integer("revision").notNull(),
    /** The version of the inbox vocabulary the blocks and the response were written in (`INBOX_WIRE_VERSION`). */
    version: integer("version").notNull(),
    title: text("title").notNull(),
    /** The context under the title, as the wire's blocks; empty where the agent wrote none. */
    blocks: jsonb("blocks").$type<readonly InboxBlock[]>().notNull(),
    /** What the item asks of the developer, as the wire's response. */
    response: jsonb("response").$type<InboxResponse>().notNull(),
    needsReply: boolean("needs_reply").notNull(),
    status: text("status").$type<InboxStatus>().notNull(),
    /** The developer's answer; null until they answer. */
    answer: jsonb("answer").$type<InboxReply>(),
    /** The key the answer, or a member's close, was sent under; null until a member answers or closes it. */
    answerKey: text("answer_key"),
    /**
     * The member who answered, any member of the task's workspace; null until
     * one does, for an answer from before answerers were kept, and once their
     * account is gone, which reads as nobody the service can name.
     */
    answeredBy: text("answered_by").references(() => user.id, { onDelete: "set null" }),
    /** Why the agent took the item back; null until it does, and on an item a member closed. */
    closedReason: text("closed_reason"),
    /**
     * The member who closed the item without answering it, any member of the
     * task's workspace; null on an open or answered item, on one its agent
     * took back, and once their account is gone.
     */
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    postedAt: timestamptz("posted_at").notNull(),
    /**
     * When the item was last answered or closed; null while it is open, and
     * on an item settled before the column was kept, which a read takes as
     * its last change until a message on its thread first moves that, the
     * write that keeps the old instant here (`inbox-store.ts`).
     */
    settledAt: timestamptz("settled_at"),
    /** When the item last changed, by the agent, an answer, or a message on its thread. */
    updatedAt: timestamptz("updated_at").notNull(),
    /**
     * The instant every member without a read marker of their own
     * (`inbox-item-read.ts`) has read the item through: the instant unread
     * was first kept, on an item that stood before it, so no item that stood
     * then reads unread until it changes again; null on an item posted
     * since, whose every change is unread until read. The migration that
     * added it stamped the standing rows through the column's default, in
     * the catalog rather than by a write of each row, and then dropped the
     * default.
     */
    readThrough: timestamptz("read_through"),
    /**
     * The message on the item's thread whose ask waits on an answer, the one
     * that may at a time; null where none waits, on every item from before
     * version 5, and once that message is gone.
     */
    openAskMessageId: uuid("open_ask_message_id").references((): AnyPgColumn => inboxMessage.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    // One item per key per agent: a post under a key it used is that item's write.
    uniqueIndex("inbox_item_agent_key").on(table.agentId, table.key),
    // A task's inbox is read the latest changed first.
    index("inbox_item_task_updated").on(table.taskId, table.updatedAt),
    // A workspace's items of agents with no task are read the latest changed first.
    index("inbox_item_org_updated").on(table.organizationId, table.updatedAt),
    // The open items of agents with no task, which every account's read of what waits names
    // beside its tasks' items, are read by workspace the latest changed first. The predicate is
    // DDL, which takes no bound parameter, so the status is inlined rather than passed.
    index("inbox_item_org_open_taskless_updated")
      .on(table.organizationId, table.updatedAt)
      .where(
        sql`${table.status} = ${sql.raw(`'${INBOX_STATUS.OPEN}'`)} and ${table.taskId} is null`,
      ),
    // What waits across the account is read on every look of a held read, its open items the latest changed first.
    index("inbox_item_user_status_updated").on(table.userId, table.status, table.updatedAt),
  ],
);
