import type { BrainRunUsage } from "@sidecar/brain";
import type { StoredUIMessage } from "@sidecar/session/ui-messages";
import {
  type MessageRole,
  type StoredMessageMetadata,
  TURN_STATUS,
  type TurnOrigin,
  type TurnStatus,
} from "@sidecar/wire";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { instant } from "./instant.js";
import type { CONVERSATION_KIND } from "./storage-vocabulary.js";

/**
 * The conversation storage the LUKE-95 rework settles on: one row per
 * message in the AI SDK's `UIMessage` shape, its parts and metadata as plain
 * `jsonb`, beside the conversation it belongs to and the turn that wrote it.
 * Nothing here is sealed: the content stored here is readable by an operator.
 *
 * The hosted brain writes here through the store writer and the read routes
 * answer from these rows. Every row is keyed by the user it belongs to and
 * cascades with the user row, so deleting an account is still one statement.
 * Deleting a plan is a soft delete of its conversation, `deleted_at` stamped
 * on the row, so its rows stand until the purge.
 *
 * The sequence counter on a conversation row is what numbers its messages;
 * it is allocated under the conversation's own row lock, counted up, and
 * never reused. Instants are `timestamp with time zone`, because these rows
 * are written and read by the service alone and a Postgres instant needs no
 * second clock beside it.
 */

type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ConversationKind>().notNull(),
    /** The runtime's own session id for this conversation: ours now, eve's later. */
    runtimeSessionId: text("runtime_session_id"),
    createdAt: instant("created_at").notNull().defaultNow(),
    lastActivityAt: instant("last_activity_at").notNull().defaultNow(),
    /** Stamped when its plan is deleted; a row so stamped is purged later and read by nothing meanwhile. */
    deletedAt: instant("deleted_at"),
    /** The next message sequence to hand out; counted up under the conversation's row lock and never reused. */
    nextMessageSeq: bigint("next_message_seq", { mode: "number" }).notNull().default(1),
    /** Counted up whenever a message of the conversation is amended, so a reader can tell a journal it has from one it has not. */
    journalRevision: bigint("journal_revision", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    // The purge runs every minute over the stamped rows alone.
    index("conversations_deleted_at")
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
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
    /** The conversation's journal revision this row was last amended at; null for a row never amended. */
    revision: bigint("revision", { mode: "number" }),
    /**
     * Where the message stands in the thread's own order, which is its
     * creation instant for a row placed as it arrived and an earlier one for
     * a row placed back among the messages it belongs with.
     */
    placedAt: instant("placed_at").notNull(),
  },
  (table) => [
    unique("messages_conversation_client").on(table.conversationId, table.clientId),
    unique("messages_conversation_seq").on(table.conversationId, table.seq),
    // The amendment read walks one conversation's amended rows in revision order.
    index("messages_conversation_revision")
      .on(table.conversationId, table.revision)
      .where(sql`${table.revision} is not null`),
  ],
);

/**
 * One run of the brain over a conversation: what opened it, where it stands,
 * what it ran under, and what it cost. `usage` holds the same four counts
 * the desktop's trace keeps, spelled the same way, and `response_ids` every
 * response OpenAI answered the turn with, in order.
 */
export const turns = pgTable(
  "turns",
  {
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
    /**
     * A content address for the composed prompt the turn ran under, the one
     * its session composed at its start; the prompt's own text is not stored,
     * because it embeds the developer's notebook and nothing replays it, so
     * there is no table behind this column.
     */
    promptHash: text("prompt_hash"),
    /** The content address of the tool set the turn was offered; the table that held the schemas is gone, so this stands alone. */
    toolSetHash: text("tool_set_hash"),
    responseIds: text("response_ids").array(),
    usage: jsonb("usage").$type<BrainRunUsage>(),
    /** eve's own id for the turn, so a relay can name to eve the turn this row is. */
    eveTurnId: text("eve_turn_id"),
    queuedAt: instant("queued_at").notNull().defaultNow(),
    startedAt: instant("started_at"),
    settledAt: instant("settled_at"),
    failure: text("failure"),
    /** What the failure was, at whatever length it came; `failure` is the word, this is the detail. */
    failureDetail: text("failure_detail"),
    cancelRequestedAt: instant("cancel_requested_at"),
  },
  (table) => [
    index("turns_by_user").on(table.userId),
    // The per-conversation latest-turn lateral reads the newest queued turn of one conversation.
    index("turns_conversation_queued").on(
      table.conversationId,
      table.queuedAt.desc(),
      table.id.desc(),
    ),
    // The abandoned-turn sweep reads the turns still running past the bound.
    // The predicate is DDL, which takes no bound parameter, so the status is inlined rather than passed.
    index("turns_running_started")
      .on(table.startedAt, table.id)
      .where(sql`${table.status} = ${sql.raw(`'${TURN_STATUS.RUNNING}'`)}`),
  ],
);

/**
 * A developer's ask between its accept and its turn. eve folds asks that
 * arrive while a turn runs into the next turn and names no turn at accept
 * time, so the ask stands on its own row from the accept, keyed by the
 * client's id once per conversation, and learns its turn when eve's
 * `turn.started` names the delivery it was handed as. The id is what the
 * caller reads and stops the ask by; `turn_id` is `hostTurnId` once known,
 * the one turn-id scheme, so a read by either id resolves through one path.
 * A retry with the same client id dispatches again where the first dispatch
 * never reached eve. A Stop asked of a queued ask stamps
 * `cancel_requested_at`, for the start that names its delivery to honour. CLAUDE.md calls the local record of
 * these "the requests"; this is the hosted tier's. An ask goes with its
 * conversation.
 *
 * A spoken ask also carries what a re-attached connection needs to pick it
 * up again: the live session it was delegated in, its task revision in that
 * session's order, how far its turn's events were told to the voice, and
 * when the run's end was told. A typed ask has none of them.
 */
export const asks = pgTable(
  "asks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** The client's own id for the ask: the idempotency key, unique in its conversation. */
    clientId: text("client_id").notNull(),
    origin: text("origin").$type<TurnOrigin>().notNull(),
    /** The eve session the ask was handed to, once eve accepted it. */
    sessionId: text("session_id"),
    /** The delivery eve named for a follow-up; an ask that opened its session has none, its turn is the session's first. */
    deliveryId: text("delivery_id"),
    /** The turn the ask ran in, as the store keys it, once known. */
    turnId: uuid("turn_id"),
    createdAt: instant("created_at").notNull().defaultNow(),
    cancelRequestedAt: instant("cancel_requested_at"),
    /** The Live API's id of the voice session a spoken ask was delegated in; null for a typed ask. */
    voiceSessionId: text("voice_session_id"),
    /** The spoken ask's place in its voice session's order of delegations: a higher revision supersedes a lower. */
    taskRevision: integer("task_revision"),
    /** The last event of the ask's turn told to the voice under this ask short of its end, written before it is told. */
    toldSeq: integer("told_seq").notNull().default(0),
    /** When the run's end was told to the voice under this ask, written before it is told. */
    endToldAt: instant("end_told_at"),
  },
  (table) => [
    uniqueIndex("asks_conversation_client").on(table.conversationId, table.clientId),
    index("asks_by_user").on(table.userId),
    index("asks_conversation_delivery").on(table.conversationId, table.deliveryId),
    index("asks_by_voice_session")
      .on(table.userId, table.voiceSessionId)
      .where(sql`${table.voiceSessionId} is not null`),
  ],
);
