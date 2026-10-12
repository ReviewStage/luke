import type { InboxKind, InboxOption, InboxReply, InboxStatus } from "@sidecar/hosted/inbox-wire";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { codingAgent } from "./coding-agent-schema.js";
import { instant } from "./instant.js";
import { plan } from "./plan-schema.js";

/**
 * inbox-schema.ts -- one item of the developer's inbox: something a coding agent needs of the developer, posted under a key of the agent's own.
 *
 * The agent names the item by its key, unique per agent, so posting under
 * the same key again is a write of this row rather than a second one: the
 * revision moves on, the item opens again, and what it asked replaces what
 * it asked before. The kind, title, details, options, and recommendation
 * are what the agent posted last; `needs_reply` is whether the agent is to
 * hear the answer as a message. The status is open until the developer
 * answers it, which writes the answer and the key the client sent it under,
 * so an answer sent again after a lost reply is taken once, or until the
 * agent closes it, which writes why. The plan is the agent's, kept on the
 * row so a plan's inbox is read by one index. The row goes with its
 * account, its plan, and its agent alike.
 */
export const inboxItem = pgTable(
  "inbox_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => codingAgent.id, { onDelete: "cascade" }),
    /** The agent's own name for the item, the same each time it means the same item. */
    key: text("key").notNull(),
    /** Moved on by every change of the agent's, which an answer names so it answers the item it was shown. */
    revision: integer("revision").notNull(),
    kind: text("kind").$type<InboxKind>().notNull(),
    title: text("title").notNull(),
    /** The context in Markdown; null where the agent wrote none. */
    details: text("details"),
    /** A choice's options; null on any other kind. */
    options: jsonb("options").$type<readonly InboxOption[]>(),
    /** The option a choice recommends, by its label; null where it recommends none. */
    recommended: text("recommended"),
    needsReply: boolean("needs_reply").notNull(),
    status: text("status").$type<InboxStatus>().notNull(),
    /** The developer's answer; null until they answer. */
    answer: jsonb("answer").$type<InboxReply>(),
    /** The key the answer was sent under; null until they answer. */
    answerKey: text("answer_key"),
    /** Why the agent took the item back; null until it does. */
    closedReason: text("closed_reason"),
    postedAt: instant("posted_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (table) => [
    // One item per key per agent: a post under a key it used is that item's write.
    uniqueIndex("inbox_item_agent_key").on(table.agentId, table.key),
    // A plan's inbox is read the latest changed first.
    index("inbox_item_plan_updated").on(table.planId, table.updatedAt),
  ],
);
