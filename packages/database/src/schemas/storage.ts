import type { BrainModelUsage, BrainRunUsage } from "@luke/features/brain";
import {
  MESSAGE_ROLE,
  type MessageRole,
  type StoredMessageMetadata,
  TURN_STATUS,
  type TurnOrigin,
  type TurnStatus,
} from "@luke/wire";
import type { StoredUIMessage } from "@luke/wire/ui-messages";
import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CONVERSATION_KIND,
  type ConversationRuntime,
  type MessageSender,
} from "../storage-vocabulary.js";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * The conversation storage the LUKE-95 rework settles on: one row per
 * message in the AI SDK's `UIMessage` shape, its parts and metadata as plain
 * `jsonb`, beside the conversation it belongs to and the turn that wrote it.
 * Nothing here is sealed: the content stored here is readable by an
 * operator.
 *
 * The hosted brain writes here through the store writer and the read routes
 * answer from these rows. Every row is keyed by the user it belongs to and
 * cascades with the user row, so deleting an account is still one statement,
 * and a conversation's children cascade with their parent. Clear is a soft
 * delete here, `deleted_at` stamped on the row, so a cleared conversation's
 * rows stand until the purge.
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
    /**
     * A child's title: the few words generated from the task its subagent was
     * handed, filled once where none stands. Null on every other kind still
     * written, and on a child no title was generated for.
     */
    title: text("title"),
    /** The conversation a child was delegated from; a child goes with its parent. */
    parentConversationId: uuid("parent_conversation_id").references(
      (): AnyPgColumn => conversations.id,
      { onDelete: "cascade" },
    ),
    /** The runtime's own session id for this conversation: ours now, eve's later. */
    runtimeSessionId: text("runtime_session_id"),
    createdAt: createdAt(),
    lastActivityAt: timestamptz("last_activity_at").notNull().defaultNow(),
    /** Stamped by Clear; a row so stamped is purged later and read by nothing meanwhile. */
    deletedAt: timestamptz("deleted_at"),
    /** The next message sequence to hand out; counted up under the conversation's row lock and never reused. */
    nextMessageSeq: bigint("next_message_seq", { mode: "number" }).notNull().default(1),
    /** Counted up whenever a message of the conversation is amended, so a reader can tell a journal it has from one it has not. */
    journalRevision: bigint("journal_revision", { mode: "number" }).notNull().default(0),
    /** A child's own short name, as the spawn call gave it; null on every other kind. */
    label: text("label"),
    /** Whether a settled child owes its parent a completion; false on every child opened now, eve handing its findings to the parent turn itself. */
    expectsCompletion: boolean("expects_completion").notNull().default(true),
    /** What answers the conversation's turns, settled as it is opened; null on a conversation from before the column, which runs on eve. */
    runtime: text("runtime").$type<ConversationRuntime>(),
    /** The harness's own session or thread id on a Claude Code or Codex conversation, which a relaunch resumes; null on eve's and before the harness answers one. */
    nativeSession: text("native_session"),
    /** The number of the last runner event projected into the conversation, so a batch the runner posts again applies nothing twice; null before a runner's first event. */
    nativeSequence: bigint("native_sequence", { mode: "number" }),
    /** What the projection of a native harness's events holds between the runner's batches: the turn under way and its step's words so far; null before the first batch. */
    nativeProjection: jsonb("native_projection"),
    /** The journal revision the conversation was last rewound to a message at, which a reader holding an older cursor reads the transcript afresh by; null on one never rewound. */
    rewoundRevision: bigint("rewound_revision", { mode: "number" }),
    /** The client id of the first line a rewind dropped from a Claude Code or Codex conversation, which the next launch's harness cuts its own session before; null once a launch has handed it over, and on one never rewound. */
    nativeRewind: text("native_rewind"),
    /**
     * The conversation's dispatch claim (`dispatch-claim.ts`): the id of the
     * one hand-over to its runtime under way, fresh for each, written with
     * what it hands over and cleared once what the runtime answered is
     * written; null where none is under way.
     */
    dispatchClaim: uuid("dispatch_claim"),
    /** When the standing dispatch claim was taken, from which it expires for a holder that died before clearing it; null with the claim. */
    dispatchClaimedAt: timestamptz("dispatch_claimed_at"),
    /** The message row of the line the standing claim hands over, which is not yet a line sent; null with the claim, and for an ask's. */
    dispatchLine: uuid("dispatch_line"),
  },
  (table) => [
    // One main stands per account at a time: Clear stamps the old one and opens the next in one
    // transaction, and a first-use creation lands one; this index is what refuses a second standing
    // main whatever path raced to it, so reads never silently pick one of two. The predicate is
    // DDL, which takes no bound parameter, so the kind is inlined rather than passed.
    uniqueIndex("conversations_standing_main")
      .on(table.userId)
      .where(
        sql`${table.kind} = ${sql.raw(`'${CONVERSATION_KIND.MAIN}'`)} and ${table.deletedAt} is null`,
      ),
    // The purge runs every minute over the stamped rows alone.
    index("conversations_deleted_at")
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
    // The children and agents reads pick one account's rows of one kind.
    index("conversations_user_kind").on(table.userId, table.kind),
    // A recorded session is found by the runtime's own id, by the session's reads and by the sweep
    // that settles an ended session's turns.
    index("conversations_runtime_session")
      .on(table.runtimeSessionId)
      .where(sql`${table.runtimeSessionId} is not null`),
    // A conversation's children are found by their parent: by the purge's cascade from a parent it
    // deletes, by a delete's stamp, and by the usage a transcript reads.
    index("conversations_parent")
      .on(table.parentConversationId)
      .where(sql`${table.parentConversationId} is not null`),
  ],
);

/**
 * That a row of `messages` is a user line no turn owns yet: the rows the
 * awaiting-line reads look among (`message-reads.ts`'s
 * `newestAwaitingLineAt`), and the predicate of the partial index they are
 * read through. The role is inlined rather than bound, because an index
 * predicate is DDL, which takes no bound parameter, and a read that bound it
 * would match the index only in a plan made for that one value, never in the
 * generic plan of a statement prepared once and run again.
 */
export function turnlessUserLine(table: {
  readonly role: SQLWrapper;
  readonly turnId: SQLWrapper;
}): SQL {
  return sql`(${table.role} = ${sql.raw(`'${MESSAGE_ROLE.USER}'`)} and ${table.turnId} is null)`;
}

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
    /** The `@luke/wire` metadata for the row's role; a system row carries none. */
    metadata: jsonb("metadata").$type<StoredMessageMetadata>(),
    createdAt: createdAt(),
    finishedAt: timestamptz("finished_at"),
    /** The conversation's journal revision this row was last amended at; null for a row never amended. */
    revision: bigint("revision", { mode: "number" }),
    /**
     * Where the message stands in the thread's own order, which is its
     * creation instant for a row placed as it arrived and an earlier one for
     * a row placed back among the messages it belongs with.
     */
    placedAt: timestamptz("placed_at").notNull(),
    /** What sent a developer's line to a coding agent (`MESSAGE_SENDER`); null on every other row, and on a line written before senders were kept. */
    sender: text("sender").$type<MessageSender>(),
    /** The member who sent the line, where a member did; set null with their account, which then reads as a former member's. */
    senderUserId: text("sender_user_id").references(() => user.id, { onDelete: "set null" }),
    /**
     * The automation whose run sent the line, or the coding agent that sent
     * it, by its name as it stood then, or the GitHub login of who caused
     * what a line GitHub sent tells of; null on every other row. Note that
     * the name is kept rather than a reference, because an automation is
     * deleted outright and a reference would have every delete look through
     * every message for its lines.
     */
    senderName: text("sender_name"),
    /**
     * The catalog id of the model the coding agent that sent the line ran
     * on then, which its harness is read off; null on every other row, and
     * on an agent's line sent before it was kept. Note that it is kept as it
     * stood, as `senderName` is, rather than read through the agent, because
     * an agent's model may change and a transcript already read never reads
     * a line again for it.
     */
    senderModel: text("sender_model"),
    /**
     * The coding agent that sent the line, by its id, which a reader opens
     * it and reads its card by; null on every other row, and on an agent's
     * line sent before it was kept. Note that it is no reference, as
     * `senderName` is none: an agent goes with its task, and a line it sent
     * another then names an agent no longer there, which reads as none.
     */
    senderAgentId: uuid("sender_agent_id"),
    /**
     * The steps of its turn begun before the turn took the line in, on a
     * developer's line a coding agent's turn under way took after its first
     * step, so a reader draws the line among the turn's work where it
     * arrived; null on every other row, and on a line taken before this was
     * kept.
     */
    takenAfterStep: integer("taken_after_step"),
  },
  (table) => [
    unique("messages_conversation_client").on(table.conversationId, table.clientId),
    unique("messages_conversation_seq").on(table.conversationId, table.seq),
    // The amendment read walks one conversation's amended rows in revision order.
    index("messages_conversation_revision")
      .on(table.conversationId, table.revision)
      .where(sql`${table.revision} is not null`),
    // The awaiting-line reads find a conversation's user lines no turn owns, a few among its every
    // row, which a scan of the conversation's sequence would read through to the last.
    index("messages_awaiting_line")
      .on(table.conversationId, table.seq)
      .where(turnlessUserLine(table)),
    // The foreign key's check on every turn deleted, by the purge, an agent's delete, or a rewind,
    // finds the messages that turn wrote, which a scan of the table would read through to the last.
    index("messages_turn").on(table.turnId).where(sql`${table.turnId} is not null`),
  ],
);

/**
 * What a turn cost: the four counts the desktop's trace keeps, spelled the
 * same way, and beside them the same counts by the model each step ran on,
 * since the model can change between steps and each is priced at its own;
 * absent on a row from before the breakdown was kept, whose every step is
 * read as the row's `model`.
 */
export interface StoredTurnUsage extends BrainRunUsage {
  readonly byModel?: readonly BrainModelUsage[];
}

/**
 * One run of the brain over a conversation: what opened it, where it stands,
 * what it ran under, and what it cost. `usage` holds the counts
 * `StoredTurnUsage` describes, and `response_ids` every response OpenAI
 * answered the turn with, in order.
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
    usage: jsonb("usage").$type<StoredTurnUsage>(),
    /** eve's own id for the turn, so a relay can name to eve the turn this row is. */
    eveTurnId: text("eve_turn_id"),
    queuedAt: timestamptz("queued_at").notNull().defaultNow(),
    startedAt: timestamptz("started_at"),
    settledAt: timestamptz("settled_at"),
    failure: text("failure"),
    /** What the failure was, at whatever length it came; `failure` is the word, this is the detail. */
    failureDetail: text("failure_detail"),
    cancelRequestedAt: timestamptz("cancel_requested_at"),
    /**
     * eve's id for the tool call whose Stop stamped `cancel_requested_at`,
     * where an agent's `stop_agent` made it: the call run again finds the turn
     * it stopped by this key, and never stops a newer one in its place. Null
     * for a Stop the developer pressed, or none.
     */
    cancelRequestKey: text("cancel_request_key"),
    /** Whether Anthropic refused Fast for a step of the turn, which then ran at standard speed instead (`coder-host/model.ts`). */
    fastRefused: boolean("fast_refused").notNull().default(false),
  },
  (table) => [
    index("turns_by_user").on(table.userId),
    // The per-conversation latest-turn lateral reads the newest queued turn of one conversation.
    index("turns_conversation_queued").on(
      table.conversationId,
      table.queuedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
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
 * up again: the live session it was delegated in, its ask revision in that
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
    createdAt: createdAt(),
    cancelRequestedAt: timestamptz("cancel_requested_at"),
    /** The Live API's id of the voice session a spoken ask was delegated in; null for a typed ask. */
    voiceSessionId: text("voice_session_id"),
    /** The spoken ask's place in its voice session's order of delegations: a higher revision supersedes a lower. */
    askRevision: integer("ask_revision"),
    /** The last event of the ask's turn told to the voice under this ask short of its end, written before it is told. */
    toldSeq: integer("told_seq").notNull().default(0),
    /** When the run's end was told to the voice under this ask, written before it is told. */
    endToldAt: timestamptz("end_told_at"),
    /**
     * For a spoken ask bound to a typed turn, which it joined under way: how
     * many of that turn's steps had begun before it, from which its answer
     * is read and its line placed. Null for every other ask, which opened its
     * turn or joined one of its own kind, and is the whole turn's.
     */
    joinedAfterStep: integer("joined_after_step"),
    /**
     * The dispatch claim the ask was handed over under (`dispatch-claim.ts`),
     * written before the runtime hears it and cleared where it answered
     * nothing: one standing beside no session is a hand-over whose holder
     * died before writing what the runtime answered, which is never handed
     * over again. Null on an ask never handed over and on one eve took.
     */
    dispatchClaim: uuid("dispatch_claim"),
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
