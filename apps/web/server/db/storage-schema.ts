import type { BrainRunUsage } from "@sidecar/brain";
import type { StoredUIMessage } from "@sidecar/session/ui-messages";
import type { MessageRole, StoredMessageMetadata } from "@sidecar/wire";
import {
  type AnyPgColumn,
  bigint,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * The conversation storage the LUKE-95 rework settles on: one row per
 * message in the AI SDK's `UIMessage` shape, its parts and metadata as plain
 * `jsonb`, beside the conversation it belongs to and the turn that wrote it.
 * Nothing here is sealed: sealing survives only for the provider keys in the
 * vault, and the content stored here is readable by an operator.
 *
 * These tables stand beside the v1 tables in `conversation-schema.ts`, which
 * every current reader still uses; nothing reads or writes these yet. Every
 * row is keyed by the user it belongs to and cascades with the user row, so
 * deleting an account is still one statement, and a conversation's children
 * cascade with their parent. Clear is a soft delete here, `deleted_at`
 * stamped on the row, so a cleared conversation's rows stand until the purge.
 *
 * The two sequence counters on a conversation row are what number its
 * messages and its events; they are allocated under the per-account lease,
 * counted up, and never reused. Instants are `timestamp with time zone`,
 * because these rows are written and read by the service alone and a
 * Postgres instant needs no second clock beside it.
 */

/** What a conversation is to the agent: its main one, an observed session's, a child's, or a private thread. */
export const CONVERSATION_KIND = {
  MAIN: "main",
  OBSERVED: "observed",
  CHILD: "child",
  THREAD: "thread",
} as const;

type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

/** What opened a turn: the developer's typed or spoken ask, a roster diff, a hold's release, or a child's completion. */
export const TURN_ORIGIN = {
  TYPED: "typed",
  SPOKEN: "spoken",
  ROSTER_DIFF: "roster_diff",
  HOLD_RELEASE: "hold_release",
  CHILD: "child",
} as const;

type TurnOrigin = (typeof TURN_ORIGIN)[keyof typeof TURN_ORIGIN];

/** Where a turn stands in its life, from the queue to one of its three ends. */
export const TURN_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  SETTLED: "settled",
  CANCELLED: "cancelled",
  FAILED: "failed",
} as const;

type TurnStatus = (typeof TURN_STATUS)[keyof typeof TURN_STATUS];

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ConversationKind>().notNull(),
    /** The observed session's provider and its id there; set on an observed conversation and on no other kind. */
    providerId: text("provider_id"),
    providerSessionId: text("provider_session_id"),
    /** The conversation a child was delegated from; a child goes with its parent. */
    parentConversationId: uuid("parent_conversation_id").references(
      (): AnyPgColumn => conversations.id,
      { onDelete: "cascade" },
    ),
    /** The parent's message whose spawn call opened the child. */
    spawnedByMessageId: uuid("spawned_by_message_id").references((): AnyPgColumn => messages.id, {
      onDelete: "cascade",
    }),
    /** The parent's message sequence a forked child's history was adopted up to; null for a child that started isolated. */
    forkOfSeq: bigint("fork_of_seq", { mode: "number" }),
    /** The runtime's own session id for this conversation: ours now, eve's later. */
    runtimeSessionId: text("runtime_session_id"),
    createdAt: instant("created_at").notNull().defaultNow(),
    lastActivityAt: instant("last_activity_at").notNull().defaultNow(),
    /** Stamped by Clear; a row so stamped is purged later and read by nothing meanwhile. */
    deletedAt: instant("deleted_at"),
    /** The next message sequence to hand out; counted up under the account lease and never reused. */
    nextMessageSeq: bigint("next_message_seq", { mode: "number" }).notNull().default(1),
    nextEventSeq: bigint("next_event_seq", { mode: "number" }).notNull().default(1),
  },
  (table) => [
    uniqueIndex("conversations_observed_session").on(
      table.userId,
      table.providerId,
      table.providerSessionId,
    ),
  ],
);

/**
 * One `UIMessage` per row. A message in flight is mutable until
 * `finished_at` is set, and its tool parts are written before the tool runs
 * and completed after, so the row is the write-ahead record a resume reads;
 * it is immutable once finished. `client_id` is the writer's own id for the
 * message, and the unique pair over the conversation is the idempotency key:
 * the same message reported twice is one row. `seq` is unique within the
 * conversation too, so two writers allocating the same position fail loudly
 * rather than leaving devices to converge on two rows in one place.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    /** The turn that wrote the message; null for a row no turn owns. */
    turnId: uuid("turn_id").references((): AnyPgColumn => turns.id),
    clientId: text("client_id").notNull(),
    role: text("role").$type<MessageRole>().notNull(),
    /** The message's parts exactly as the SDK shapes them; read back through `readStoredUIMessages`, never the SDK's validator alone. */
    parts: jsonb("parts").$type<StoredUIMessage["parts"]>().notNull(),
    /** The `@sidecar/wire` metadata for the row's role; a system row carries none. */
    metadata: jsonb("metadata").$type<StoredMessageMetadata>(),
    createdAt: instant("created_at").notNull().defaultNow(),
    finishedAt: instant("finished_at"),
  },
  (table) => [
    unique("messages_conversation_client").on(table.conversationId, table.clientId),
    unique("messages_conversation_seq").on(table.conversationId, table.seq),
  ],
);

/**
 * One run of the brain over a conversation: what opened it, where it stands,
 * what it ran under, and what it cost. `usage` holds the same four counts
 * the v1 run row and the desktop's trace keep, spelled the same way, and
 * `response_ids` every response OpenAI answered the turn with, in order.
 */
export const turns = pgTable("turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  origin: text("origin").$type<TurnOrigin>().notNull(),
  status: text("status").$type<TurnStatus>().notNull(),
  model: text("model"),
  reasoningEffort: text("reasoning_effort"),
  /** The content address of the prompt the turn ran under. */
  promptHash: text("prompt_hash"),
  /** The content address of the tool set the turn was offered. */
  toolSetHash: text("tool_set_hash"),
  responseIds: text("response_ids").array(),
  usage: jsonb("usage").$type<BrainRunUsage>(),
  queuedAt: instant("queued_at").notNull().defaultNow(),
  startedAt: instant("started_at"),
  settledAt: instant("settled_at"),
  failure: text("failure"),
  cancelRequestedAt: instant("cancel_requested_at"),
});

/**
 * The one lease per account under which turns are drained and sequences
 * allocated: who holds it, since when, when it last beat, and when it lapses
 * unrenewed. One row per user, so the user id is the key.
 */
export const conversationLease = pgTable("conversation_lease", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  owner: text("owner").notNull(),
  acquiredAt: instant("acquired_at").notNull(),
  heartbeatAt: instant("heartbeat_at").notNull(),
  expiresAt: instant("expires_at").notNull(),
});
