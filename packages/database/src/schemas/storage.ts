import type { RunModelUsage, RunUsage } from "@luke/features/turn-run";
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
    /** What the turns' messages of a Claude Code or Codex conversation have handed its harness's session, as content addresses (`coder-host/turn-context.ts`'s `TurnHanded`), so a turn hands the call's words, the task, and an operator's desk only where they changed; null before the first turn's message. */
    nativeHanded: jsonb("native_handed"),
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
 * That a row of `messages` is no developer's line its hand-over withdrew
 * and no turn took since: every read that shows a line reads it through
 * this. A turn's own row stands whatever its stamp says, because a release
 * that kept no stamp takes a withdrawn line into its turn and leaves the
 * stamp behind.
 */
export function standingLine(table: {
  readonly withdrawnAt: SQLWrapper;
  readonly turnId: SQLWrapper;
}): SQL {
  return sql`(${table.withdrawnAt} is null or ${table.turnId} is not null)`;
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
    /**
     * When the hand-over of a developer's line to a coding agent answered
     * that the runtime did not take it; null on every other row, and on a
     * withdrawn line a turn took all the same. Note that the row is kept
     * rather than deleted, because a hand-over past its deadline, or whose
     * record failed after the runtime took it, may still reach a turn, and
     * the row is the one record of what the line says carried it and who
     * sent it. Every read leaves such a row out until a turn takes it, and
     * the maintenance sweep deletes it once no turn can.
     */
    withdrawnAt: timestamptz("withdrawn_at"),
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
    // The sweep finds the withdrawn lines no turn took in time, a handful among every row.
    index("messages_withdrawn").on(table.withdrawnAt).where(sql`${table.withdrawnAt} is not null`),
  ],
);

/**
 * What a turn cost: the four counts the desktop's trace keeps, spelled the
 * same way, and beside them the same counts by the model each step ran on,
 * since the model can change between steps and each is priced at its own;
 * absent on a row from before the breakdown was kept, whose every step is
 * read as the row's `model`.
 */
export interface StoredTurnUsage extends RunUsage {
  readonly byModel?: readonly RunModelUsage[];
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
    /**
     * The coding agent whose `stop_agent`, or whose Start continuing this
     * turn's agent, made the Stop, written with `cancel_requested_at`, so the
     * agent's starter is not told of a Stop it made itself
     * (`starter-notices.ts`). Null for a Stop the developer pressed or Luke
     * made, and for none. Named by id and held to nothing, so the turn
     * outlives that agent.
     */
    cancelRequestedBy: uuid("cancel_requested_by"),
    /**
     * Whether the Stop was its pilot tree's Running switched off
     * (`tasks/running-tree.ts`), written with `cancel_requested_at`, so no
     * starter is told of it (`starter-notices.ts`) and the switch on again
     * resumes exactly the agents it stopped.
     */
    cancelRequestedForRunning: boolean("cancel_requested_for_running").notNull().default(false),
    /** Whether Anthropic refused Fast for a step of the turn, which then ran at standard speed instead (`coder-host/model.ts`). */
    fastRefused: boolean("fast_refused").notNull().default(false),
    /** How many notes a native coding agent's turn has taken on its plan over Luke's MCP server, reserved before each save (`edit_plan`'s per-turn cap); eve keeps its own count in its session. */
    planNotesTaken: integer("plan_notes_taken").notNull().default(0),
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
 * The hand-overs waiting for their conversation's dispatch claim
 * (`dispatch-claim.ts`), one row a waiter, numbered by the database as they
 * queue, so a claim goes to the waiter that queued first, as the advisory
 * lock the claim replaced queued them, whichever instance each runs on. A
 * waiter stamps `seen_at` with the database's own clock each time it asks
 * for the claim, and its row goes once it claims or gives up; one whose
 * waiter died stops holding the queue a couple of seconds after its last ask.
 */
export const dispatchWaiters = pgTable(
  "dispatch_waiters",
  {
    place: bigint("place", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seenAt: timestamptz("seen_at").notNull().defaultNow(),
  },
  (table) => [index("dispatch_waiters_conversation_place").on(table.conversationId, table.place)],
);
