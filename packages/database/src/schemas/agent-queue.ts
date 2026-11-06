import type { HostedApiError } from "@repo/features";
import type { QueuePause } from "@repo/features/agent-queue-wire";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { boolean, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

export const queuedMessage = pgTable(
  "queued_message",
  {
    id: uuid("id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    attachments:
      jsonb("attachments").$type<readonly (AgentAttachment & { readonly id: string })[]>(),
    editing: boolean("editing").notNull().default(false),
    claimedAt: timestamptz("claimed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("queued_message_agent_position").on(table.agentId, table.position)],
);

export const agentQueue = pgTable("agent_queue", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agentTable.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  pausedBecause: text("paused_because").$type<QueuePause>(),
  pausedRefusal: text("paused_refusal").$type<HostedApiError>(),
});
