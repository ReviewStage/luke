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

export const descriptionCommentThread = pgTable(
  "description_comment_thread",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    scope: text("scope").$type<DescriptionCommentScope>().notNull(),
    quote: text("quote").notNull(),
    anchorFrom: integer("anchor_from"),
    anchorTo: integer("anchor_to"),
    section: text("section").notNull(),
    pageId: uuid("page_id"),
    pageVersion: integer("page_version"),
    pageElement: text("page_element"),
    status: text("status").$type<DescriptionCommentStatus>().notNull(),
    revision: integer("revision").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("description_comment_thread_task_created").on(table.taskId, table.createdAt),
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
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").$type<DescriptionCommentEntryKind>().notNull(),
    actor: text("actor").$type<DescriptionCommentActor>().notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "set null" }),
    words: text("words"),
    askedActor: text("asked_actor").$type<DescriptionCommentActor>(),
    askedAgentId: uuid("asked_agent_id").references(() => agentTable.id, {
      onDelete: "set null",
    }),
    clientKey: text("client_key"),
    createdAt: timestamptz("created_at").notNull(),
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
