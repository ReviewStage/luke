import { INBOX_STATUS, type InboxStatus } from "@repo/features/inbox-wire";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { organization, user } from "./auth.js";
import { inboxMessage } from "./inbox-message.js";
import { task } from "./task.js";

export const inboxItem = pgTable(
  "inbox_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    addresseeId: text("addressee_id").references(() => user.id, { onDelete: "set null" }),
    key: text("key").notNull(),
    revision: integer("revision").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    needsReply: boolean("needs_reply").notNull(),
    status: text("status").$type<InboxStatus>().notNull(),
    answerKey: text("answer_key"),
    answeredBy: text("answered_by").references(() => user.id, { onDelete: "set null" }),
    closedReason: text("closed_reason"),
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    postedAt: timestamptz("posted_at").notNull(),
    settledAt: timestamptz("settled_at"),
    updatedAt: timestamptz("updated_at").notNull(),
    readThrough: timestamptz("read_through"),
    openAskMessageId: uuid("open_ask_message_id").references((): AnyPgColumn => inboxMessage.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("inbox_item_agent_key").on(table.agentId, table.key),
    index("inbox_item_task_updated").on(table.taskId, table.updatedAt),
    index("inbox_item_org_updated").on(table.organizationId, table.updatedAt),
    index("inbox_item_org_open_taskless_updated")
      .on(table.organizationId, table.updatedAt)
      .where(
        sql`${table.status} = ${sql.raw(`'${INBOX_STATUS.OPEN}'`)} and ${table.taskId} is null`,
      ),
    index("inbox_item_user_status_updated").on(table.userId, table.status, table.updatedAt),
  ],
);
