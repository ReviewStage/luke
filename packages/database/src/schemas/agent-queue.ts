/**
 * agent-queue.ts -- a coding agent's queue: the messages members queued behind its running turn, and whether it stands paused.
 *
 * A message queued while the agent works waits here, unsent and with no row
 * in the transcript, until the agent's turn is over, when the service sends
 * the first one as a turn of its own (`@luke/features/agent-queue-wire`).
 * Every row goes with its agent, and a member's rows with their account.
 */

import type { HostedApiError } from "@luke/features";
import type { QueuePause } from "@luke/features/agent-queue-wire";
import type { AgentAttachment } from "@luke/features/agent-wire";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

/**
 * One queued message. `position` is its place in the agent's queue, the
 * lowest going first, minted past the highest as it is queued and written
 * again for every row when the queue is put in a new order. `client_key` is
 * the send's own key, which the message goes under when it is sent, so a
 * hand-off repeated sends it once, and a queue repeated under it queues it
 * once. `user_id` is the member who queued it, whose message it goes as.
 * `held_until` is how long a member's edit of it holds it out of the
 * hand-off, which passes over it meanwhile; null while nobody edits it, and
 * lapsed once an edit left open has stood that long. `claimed_at` is when
 * the hand-off took it to send, after which no member's edit, delete, or
 * new order reaches it and no window lists it; null until then, and lapsed
 * as a hold does, so a send cut off is sent again under its key.
 */
export const queuedMessage = pgTable(
  "queued_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    clientKey: text("client_key").notNull(),
    text: text("text").notNull(),
    /** The files that go with the words, as the queue change carried them, each beside the id it was minted as it was written, by which a window reads its bytes; null where none did. */
    attachments:
      jsonb("attachments").$type<readonly (AgentAttachment & { readonly id: string })[]>(),
    heldUntil: timestamptz("held_until"),
    claimedAt: timestamptz("claimed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("queued_message_agent_position").on(table.agentId, table.position),
    uniqueIndex("queued_message_agent_key").on(table.agentId, table.clientKey),
  ],
);

/**
 * Where an agent's queue stands: its revision, one number every write to
 * the queue moves on in the same transaction (a message queued, edited,
 * held or let go, claimed or released, put in a new order, deleted, or sent,
 * and a pause written or dropped), which wakes every reader keyed to it and
 * tells a window a change it made has landed once a read stands at the
 * number its answer named; and whether it stands paused, and why: by a
 * Stop or any cancel, a failed turn, or a refused hand-off, with the
 * service's word for what refused it, and null while it runs. At most one
 * row per agent, written by its queue's first change.
 */
export const agentQueue = pgTable("agent_queue", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agentTable.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  pausedBecause: text("paused_because").$type<QueuePause>(),
  pausedRefusal: text("paused_refusal").$type<HostedApiError>(),
});
