import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { type AutomationFiring, FIRING_HANDS_OUTSIDE_WORDS } from "@luke/features/automation-wire";
import {
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  type RunEvent,
  type RunTurnOrigin,
  STEP_START_PART,
  settledToolPart,
  toolPartType,
  UI_PART_STATE,
  UI_PART_TYPE,
} from "@luke/features/turn-run";
import { causeKind } from "@luke/runtime/effect";
import {
  type AgentMessageMetadata,
  type AutomationLineMetadata,
  type CommentLineMetadata,
  type GitHubLineMetadata,
  isWireString,
  jsonRoundTrip,
  type LukeLineMetadata,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type SchemaPath,
  type SchemaRefusal,
  type StartLineMetadata,
  type StoredMessageMetadata,
  type ThreadLineMetadata,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnOrigin,
  type TurnStatus,
  type TypedAskMetadata,
  UNKNOWN_ACTION_STATUS,
  type UnparsedWireValue,
} from "@luke/wire";
import { sentLineId } from "@luke/wire/host-ids";
import {
  isSettledToolPartState,
  isStoredToolPart,
  readStoredUIMessages,
  type StoredToolPart,
  type StoredUIMessage,
  TOOL_PART_STATE,
} from "@luke/wire/ui-messages";
import {
  asSchema,
  type ReasoningUIPart,
  type ToolSet,
  type ToolUIPart,
  type UIMessage,
  type UITools,
} from "ai";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  Cause,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  Metric,
  Option,
  Result,
  Schema,
} from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import {
  CONVERSATION_KIND,
  MESSAGE_SENDER,
  OPERATOR_NOTICE_KIND,
  type OperatorNoticeKind,
} from "../storage-vocabulary.js";
import { type HandedFile, lineParts, receivedPartsOf } from "./attached-file-parts.js";
import {
  EpochMillisColumnSchema,
  InstantColumnSchema,
  nullable,
  TurnUsageColumnSchema,
} from "./columns.js";
import {
  DispatchClaimHeld,
  dispatchClaimStands,
  recordedWithinExpiry,
  releaseDispatchClaim,
  takeDispatchClaim,
  waitingOutDispatchClaim,
} from "./dispatch-claim.js";
import { COALESCED_LINE_SEPARATOR, noReceiptOfLine } from "./message-reads.js";
import { writeOperatorNotice } from "./operator-notices.js";

/**
 * The store writer: the one path by which a `messages` or `turns` row is
 * written. It consumes the brain's run event stream (`RunEvent`,
 * every kind of turn) and keeps the record the plan describes: a turn row
 * from queued through running to its end, one assistant message per turn
 * that is the turn's journal while it runs — each tool call written in
 * `input-available` before it executes and moved to `output-available` or
 * `output-error` as its result lands, `finished_at` set once and the row's
 * words immutable after — the user messages the turn opened with, and a
 * compaction message where the compaction's owner hands one over. A row's
 * place in the sequence is the one thing a finished row may still lose: the
 * sequence is what a device pages by, so a row moved into a turn, or a
 * turn's work moved behind the ask it answers, takes a fresh position and is
 * read again there rather than left where a device already passed it. Every write is
 * idempotent: a message by its `(conversation_id, client_id)`, a turn by its
 * id, a tool part by its call id, so an event delivered twice writes one row
 * and a stream replayed from its start changes nothing.
 *
 * A turn's journal grows in place, and a batch of events (`consumeAll`)
 * grows it in memory under one lock and lands it once as the write ends,
 * with one move of the journal revision, so a turn whose events arrive
 * together rewrites its parts once rather than once for each.
 *
 * Every write runs under a lock on the conversation row, which serializes
 * the conversation's writers, so a check made before an insert holds when
 * the insert runs. Sequences are allocated from the row's own counters,
 * each allocation landing on the first position no row of the conversation
 * holds, so a position taken outside the counter costs nothing but a skip.
 * The unique constraint on `(conversation_id, seq)` stays the backstop: a
 * writer that still lands on a taken position is one that wrote outside
 * this lock, and its violation surfaces rather than being retried into
 * place. Nothing here reads a row back for the model: what is written is
 * held to the vocabulary before it lands, through the same reader the
 * store's reads go through, so no row can carry a tool the catalog does not
 * register, an input its schema refuses, or metadata outside the set. A
 * message refused there is refused whole and reported, never cut down to
 * the parts that would pass: a cut message says something its author did not.
 *
 * One outcome any call can have is an answer the catalog never wrote: the
 * envelope saying the call was dispatched and its effect is unknown, which
 * the runtime hands the model for a tool that did not answer and this writer
 * gives a call the turn ended without answering. A tool's declared output
 * schema therefore has to admit that envelope, or the row of such a call
 * could not be read back; the writer holds the catalog to it once, when it
 * is composed, and refuses to exist over a catalog that fails it.
 *
 * Every statement is a Drizzle builder over the tables
 * `schemas/storage.ts` declares, yielded as the `Effect` Drizzle's own driver
 * makes it over the same `PgClient` the ambient `SqlClient` is; the transaction is
 * that client's own and the driver reads it from the running fiber, which is
 * what puts the sequence allocation and the writes that follow it inside the
 * conversation's lock rather than beside it. Each row a statement answers is
 * still decoded by a `Schema` rather than trusted, and a write's `jsonb`
 * column is handed the value itself rather than its JSON text, since
 * rendering one is the column's own work. What the builder cannot spell is a
 * named `sql` fragment inside the one rendered statement: the journal
 * revision's own data-modifying CTE, the sequence high-water mark, and the
 * `jsonb` field tests a spoken row is found by. The `StoreWriter` methods are
 * effects too, so the edge that owns the connection is the one that runs
 * them and a caller composes a write into the request it is already on.
 */

/** The envelope of a call whose effect is unknown: dispatched, its answer lost, so it may have happened. */
function unknownOutcome(reason: string) {
  return { status: UNKNOWN_ACTION_STATUS, reason } as const;
}

/** The one output any tool's schema must admit: the envelope of a call whose effect is unknown. */
const UNKNOWN_OUTCOME_PROBE = unknownOutcome("the call was dispatched and its effect is unknown");

/** The tools whose declared output schema would refuse the unknown outcome's envelope. */
const toolsRefusingUnknownOutcome = (tools: ToolSet): Effect.Effect<readonly string[]> =>
  Effect.map(
    Effect.forEach(Object.entries(tools), ([name, declared]) => {
      if (declared.outputSchema === undefined) return Effect.succeed(undefined);
      const validate = asSchema(declared.outputSchema).validate;
      if (validate === undefined) return Effect.succeed(undefined);
      // The SDK's validate answers a value or a thenable, so the door settles either.
      return Effect.map(
        Effect.promise(() => Promise.resolve(validate(UNKNOWN_OUTCOME_PROBE))),
        (result) => (result.success ? undefined : name),
      );
    }),
    (names) => names.filter((name) => name !== undefined),
  );

export interface ConversationTarget {
  readonly userId: string;
  readonly conversationId: string;
}

interface StoreWriterOptions {
  /** The catalog's `tool()` declarations by name: what a stored tool part may name, and what its input is held to. */
  readonly tools: ToolSet;
}

/** A coding agent's turn a write settled, as the writer tells `SettledTurnListener`. */
export interface SettledAgentTurn {
  readonly userId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly status: TurnStatus;
  /** The failure word a failed turn was settled with; null for any other end. */
  readonly failure: string | null;
  /** How long the turn ran: from its start, or its queueing for one that never started, to its settle. */
  readonly ranMs: number;
}

/**
 * What hears of each coding agent turn the writer settled, once the write's
 * transaction is done: the service's analytics (`server-events.ts`). Read
 * optionally, so a runtime or a test that provides none hears nothing, and
 * what it does never fails the write it follows. Note that a write run
 * inside a caller's transaction is heard as its savepoint ends, before the
 * caller's commit, so a listener that must not hear a settle rolled back
 * reads the turn's row again once that transaction is over.
 */
export class SettledTurnListener extends Context.Service<
  SettledTurnListener,
  { readonly heard: (turn: SettledAgentTurn) => Effect.Effect<void, never, DatabaseServices> }
>()("SettledTurnListener") {}

/** What one write did: landed, found its row already standing, or had nothing to do for this kind. */
export const STORE_WRITE_EFFECT = {
  WRITTEN: "written",
  REPEATED: "repeated",
  IGNORED: "ignored",
} as const;

type StoreWriteEffect = (typeof STORE_WRITE_EFFECT)[keyof typeof STORE_WRITE_EFFECT];

/**
 * Why a write was refused: the row it needs is not there, the row or call it
 * would change is closed, or what it carries is outside the vocabulary.
 */
export const STORE_WRITE_REFUSAL = {
  NO_CONVERSATION: "no_conversation",
  NO_TURN: "no_turn",
  NO_CALL: "no_call",
  FINISHED: "finished",
  MESSAGE_REFUSED: "message_refused",
  BUSY: "busy",
} as const;

type StoreWriteRefusal = (typeof STORE_WRITE_REFUSAL)[keyof typeof STORE_WRITE_REFUSAL];

/** Why a write did not land, by the one word the writer has for it. */
type Refused<Refusal extends StoreWriteRefusal> = { readonly refusal: Refusal };

/** A message the vocabulary refused, with where and why, so the caller can say which field. */
type MessageRefused = Refused<typeof STORE_WRITE_REFUSAL.MESSAGE_REFUSED> & {
  readonly reason: SchemaRefusal;
  readonly path: SchemaPath;
};

const NO_CONVERSATION: Refused<typeof STORE_WRITE_REFUSAL.NO_CONVERSATION> = {
  refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION,
};

const NO_TURN: Refused<typeof STORE_WRITE_REFUSAL.NO_TURN> = {
  refusal: STORE_WRITE_REFUSAL.NO_TURN,
};

/** Another hand-over's dispatch claim stood on the conversation past the bound this write waits for it (`dispatch-claim.ts`); nothing was written. */
const CONVERSATION_BUSY: Refused<typeof STORE_WRITE_REFUSAL.BUSY> = {
  refusal: STORE_WRITE_REFUSAL.BUSY,
};

/** What a write did, or why it did not land: the effect, or the refusal with what is known of it. */
export type StoreWriteResult = Result.Result<
  StoreWriteEffect,
  | Refused<
      | typeof STORE_WRITE_REFUSAL.NO_CONVERSATION
      | typeof STORE_WRITE_REFUSAL.NO_TURN
      | typeof STORE_WRITE_REFUSAL.NO_CALL
      | typeof STORE_WRITE_REFUSAL.FINISHED
    >
  | MessageRefused
>;

type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

/** A turn queued ahead of its start: what opened it and, where the caller knows them, what it will run under. */
interface TurnEnqueue {
  /** The turn's id where the runtime minted one already; minted here otherwise. */
  readonly turnId?: string;
  /** eve's own id for the turn, where the relay queues the row at eve's start; the opener's inbox row names none, since eve has not yet started a turn for it. */
  readonly eveTurnId?: string;
  readonly origin: TurnOrigin;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly promptHash?: string;
  readonly toolSetHash?: string;
}

interface TurnCancelRequest {
  readonly turnId: string;
  readonly at: Date;
  /** eve's id for the tool call the Stop is made under, where an agent's `stop_agent` made it, written beside the instant. */
  readonly key?: string;
  /** The coding agent whose `stop_agent`, or whose Start continuing the turn's agent, made the Stop; none for the developer's or Luke's. */
  readonly by?: string;
}

type TurnCancelResult = Result.Result<StoreWriteEffect, typeof NO_CONVERSATION | typeof NO_TURN>;

type TurnEnqueueResult = Result.Result<
  { readonly turnId: string; readonly effect: StoreWriteEffect },
  typeof NO_CONVERSATION
>;

/**
 * What sent a line to a coding agent, as its row keeps it: the member by
 * their account, Luke, an automation by its name as it stands at the send,
 * GitHub by the login of who caused what it tells of, or another coding
 * agent by its name, its id, and the model it runs on, as they stand at the
 * send.
 */
export type LineSender =
  | { readonly kind: typeof MESSAGE_SENDER.MEMBER; readonly userId: string }
  | { readonly kind: typeof MESSAGE_SENDER.LUKE }
  | { readonly kind: typeof MESSAGE_SENDER.AUTOMATION; readonly name: string }
  | { readonly kind: typeof MESSAGE_SENDER.GITHUB; readonly login: string }
  | {
      readonly kind: typeof MESSAGE_SENDER.AGENT;
      readonly agentId: string;
      readonly name: string;
      readonly model: string;
    };

/** The name a line's row keeps beside its sender's kind: an automation's or an agent's, or the GitHub login; none for any other. */
function senderNameOf(sender: LineSender | undefined): string | null {
  switch (sender?.kind) {
    case MESSAGE_SENDER.AUTOMATION:
    case MESSAGE_SENDER.AGENT:
      return sender.name;
    case MESSAGE_SENDER.GITHUB:
      return sender.login;
    default:
      return null;
  }
}

/**
 * The line to a coding agent as the message route and the queue's drain
 * write it: its words, the files attached to it, each image with what was
 * kept of it, the client's key for the send, what sent it, and what the row
 * says carried it: the developer's typed ask where it names nothing else,
 * or another coding agent's message, a thread, a plan comment, a Start's
 * brief, GitHub, Luke, or an
 * automation's run.
 */
interface AwaitingLineWrite {
  readonly text: string;
  readonly clientKey: string;
  readonly attachments?: readonly HandedFile[] | undefined;
  /** What the line mentioned, as eve was handed it (`attached-file-parts.ts`); nothing where it mentioned nothing eve cannot read. */
  readonly mentioned?: string | undefined;
  readonly sender: LineSender;
  readonly metadata?: AwaitingLineMetadata | undefined;
}

/** What an awaiting line says carried it. */
export type AwaitingLineMetadata =
  | TypedAskMetadata
  | AgentMessageMetadata
  | ThreadLineMetadata
  | CommentLineMetadata
  | StartLineMetadata
  | GitHubLineMetadata
  | LukeLineMetadata
  | AutomationLineMetadata;

/** An awaiting line naming no channel is the developer's typed ask. */
const TYPED_LINE_METADATA: TypedAskMetadata = {
  channel: MESSAGE_CHANNEL.TYPED,
};

/** A line Luke sent the agent on its own. */
export const LUKE_LINE_METADATA: LukeLineMetadata = { channel: MESSAGE_CHANNEL.LUKE };

/**
 * An automation's run's prompt, saying whether what fired the run put words
 * its owner did not write beside it, which the line keeps for the rest of
 * the conversation's life, whatever becomes of the automation and its runs.
 */
export function automationLineMetadata(firing: AutomationFiring): AutomationLineMetadata {
  return {
    channel: MESSAGE_CHANNEL.AUTOMATION,
    outside_words: FIRING_HANDS_OUTSIDE_WORDS[firing.kind],
  };
}

/** What writing an awaiting line did: the row, written now or already standing under the key, or nothing where the dispatch answered nothing; or a refusal. */
type AwaitingLineWritten = Result.Result<
  Option.Option<{
    readonly id: string;
    readonly effect: StoreWriteEffect;
    /** The transaction that wrote the row, where this write wrote it. */
    readonly txid?: string;
  }>,
  typeof NO_CONVERSATION | typeof CONVERSATION_BUSY | MessageRefused
>;

/**
 * The line a turn received and the turn that received it: as eve's relay
 * reads it off eve's stream, by its text parts joined (`attached-files.ts`);
 * or as a native harness's runner names it, by the
 * client id of the row it was written under, which the runner was handed
 * with the line.
 */
type AwaitingLineTake =
  | { readonly text: string; readonly turnId: string }
  | { readonly clientId: string; readonly turnId: string };

/**
 * The longest the hand-over to eve inside an awaiting line's write may take
 * before it is given up: eve answers a follow-up in well under a second and
 * its own not-ready loop ends at twenty, so one not answered in thirty is
 * not going to.
 */
const AWAITING_LINE_DISPATCH_DEADLINE = Duration.seconds(30);

/** The rows the turn took, by id, oldest first; none where no run of lines with those words awaited; or the turn does not stand. */
type AwaitingLineTaken = Result.Result<readonly string[], typeof NO_CONVERSATION | typeof NO_TURN>;

/**
 * The one path by which a conversation's rows are written, each method an
 * effect over the ambient client: a caller composes one into the request it
 * is already running rather than awaiting it out of band.
 */
export interface StoreWriter {
  /** Consumes one event of the run stream for the conversation it names. */
  consume(target: ConversationTarget, event: RunEvent): Write<StoreWriteResult>;
  /**
   * Consumes a batch of the run stream's events, in order, as one locked
   * write: the conversation is locked once, each journal is read once, and
   * a journal the batch grew lands once, its revision moved once, however
   * many events grew it. Answers each event's own result, in order; a
   * conversation that does not stand refuses every event.
   */
  consumeAll(
    target: ConversationTarget,
    events: readonly RunEvent[],
  ): Write<readonly StoreWriteResult[]>;
  /** Writes a turn as queued, ahead of the stream telling its start; answers the turn's id. */
  enqueueTurn(target: ConversationTarget, enqueue: TurnEnqueue): Write<TurnEnqueueResult>;
  /** Stamps the instant a Stop was asked on a turn the conversation holds, once. */
  requestTurnCancel(target: ConversationTarget, cancel: TurnCancelRequest): Write<TurnCancelResult>;
  /**
   * Writes the developer's line to a coding agent as a row awaiting its
   * turn, kept only where the dispatch handed in answers that eve took it:
   * the dispatch is the hand-over to eve, run under the conversation's
   * dispatch claim (`dispatch-claim.ts`) with no transaction open, after
   * the row is written with the claim, so the take of the line into the
   * turn eve opens on it finds the row standing; and a dispatch that
   * answers nothing withdraws the row, which every read then leaves out
   * unless a turn eve hands the line to after all takes it, and which a
   * send repeated under its key writes afresh. No lock is held while eve answers,
   * so the journal of a turn under way, and every other write of the
   * conversation, lands meanwhile. The row stands under the client's key
   * for the send (`sentLineId`), and a line already standing under that key
   * is answered as repeated without the dispatch being run, so two sends
   * carrying one key, however they race, hand eve the words once. The whole
   * write cannot be interrupted, because eve takes the message before the
   * claim records what it answered: a caller that went in between would
   * leave the claim to expire and the line standing with eve's answer
   * unread, so the dispatch is bounded by a deadline of its own instead,
   * past which it is read as having answered nothing.
   */
  writeAwaitingLine(
    target: ConversationTarget,
    line: AwaitingLineWrite,
    dispatch: Effect.Effect<boolean>,
  ): Write<AwaitingLineWritten>;
  /**
   * Takes into the turn the lines awaiting one the receipt is of: the oldest
   * run of the conversation's user rows no turn owns whose words, joined as
   * eve coalesces messages, are the ones received, eve having received the
   * lines in the order they were sent. A run of one is a line eve handed
   * the turn alone; a longer run is steers eve folded into one step's input.
   * Each row takes the turn in place at a bumped revision, so a device
   * reading from its revision sees the line again where it stands, now the
   * turn's, and keeps how many of the turn's steps had begun before it, so
   * a line that steered a turn under way is drawn among its work where it
   * arrived rather than ahead of the turn. A take by client id takes the one awaiting row written
   * under it. A withdrawn line is taken as any other, standing again with
   * what carried it and who sent it, where it lengthens the run the lines
   * eve did take make. Answers the rows taken, or none where no such run awaits, which
   * is every line of a conversation that is no coding agent's.
   */
  takeAwaitingLine(target: ConversationTarget, take: AwaitingLineTake): Write<AwaitingLineTaken>;
}

/** The plan's turn origin for each origin the brain's stream names: each is written as reported. */
const TURN_ORIGIN_OF_RUN_ORIGIN = {
  [RUN_TURN_ORIGIN.TYPED]: TURN_ORIGIN.TYPED,
  [RUN_TURN_ORIGIN.SPOKEN]: TURN_ORIGIN.SPOKEN,
  [RUN_TURN_ORIGIN.CHILD]: TURN_ORIGIN.CHILD,
} as const satisfies Record<RunTurnOrigin, TurnOrigin>;

function turnStatusOf(status: RunStatus): TurnStatus {
  switch (status) {
    case RUN_STATUS.SUCCEEDED:
      return TURN_STATUS.SETTLED;
    case RUN_STATUS.CANCELLED:
      return TURN_STATUS.CANCELLED;
    case RUN_STATUS.FAILED:
    case RUN_STATUS.TIMED_OUT:
    case RUN_STATUS.INTERRUPTED:
    case RUN_STATUS.QUEUED:
    case RUN_STATUS.RUNNING:
      return TURN_STATUS.FAILED;
  }
}

/** The longest a failed turn's detail is kept, in characters, cut from the end here whatever its teller sent. */
const TURN_FAILURE_DETAIL = { CHARS: 500 } as const;

const TERMINAL_TURN_STATUSES: ReadonlySet<TurnStatus> = new Set([
  TURN_STATUS.SETTLED,
  TURN_STATUS.CANCELLED,
  TURN_STATUS.FAILED,
]);

type ToolPart = ToolUIPart<UITools>;

type Parts = StoredUIMessage["parts"];

const MODEL_AUTHORED = { author: MESSAGE_AUTHOR.MODEL } as const;

/**
 * A row a statement had to answer. Its absence is this writer's own
 * invariant broken — a conversation that vanished under its own lock, an
 * insert that returned nothing — which is a defect rather than an outcome a
 * caller could act on, so it dies with the same words it threw before.
 */
function required<A>(row: Option.Option<A>, absent: string): Effect.Effect<A> {
  return Option.match(row, { onNone: () => Effect.die(new Error(absent)), onSome: Effect.succeed });
}

const readsJsonObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

const readsPartsShape = Schema.is(Schema.Array(Schema.Struct({ type: Schema.String })));

/**
 * The three `jsonb` columns this writer carries whose shape belongs to a
 * vocabulary elsewhere: a message's parts and metadata, and an event's
 * payload. Each is declared here as far as a column can be held — parts an
 * array of parts, metadata a JSON object — and no further, because the
 * vocabulary is `readStoredUIMessages`'s, which `admitted` below runs over
 * every message before it lands and again before any amendment does. A
 * column's own schema is what refuses a row that could never be either.
 *
 * A write and a read name these the same way, because a `jsonb` column
 * renders its own value: the builder hands the driver the JSON text of
 * whatever a write carried and answers a read the parsed value back, so
 * neither side spells the serialization and nothing casts a parameter to
 * `jsonb` in a statement.
 */
const StoredPartsColumnSchema: Schema.Codec<Parts> = Schema.declare((input): input is Parts =>
  readsPartsShape(input),
);

const MessageMetadataColumnSchema: Schema.Codec<StoredMessageMetadata> = Schema.declare(
  (input): input is StoredMessageMetadata => readsJsonObject(input),
);

const MessageRoleSchema = Schema.Literals(Object.values(MESSAGE_ROLE));

const TurnStatusSchema = Schema.Literals(Object.values(TURN_STATUS));

const TurnOriginSchema = Schema.Literals(Object.values(TURN_ORIGIN));

const RowIdSchema = Schema.Struct({ id: Schema.String });

/** A message row as its insert answers it: its id, and the transaction that wrote it, which Neon Realtime names the change by. */
const InsertedRowSchema = Schema.Struct({ id: Schema.String, txid: Schema.String });

/** The id of the transaction a statement runs in, read in its own `RETURNING`, as a decimal string so its 64 bits stay exact. */
const CURRENT_TXID = sql<string>`pg_current_xact_id()::text`;

/**
 * The `jsonb` field a stored spoken line is told apart by, which the builder
 * has no operator for: the call it was said on, which an earlier version
 * wrote on its own metadata. One fragment, named once, so the key's
 * spelling stands in a single place.
 */
const SPOKEN_VOICE_SESSION_ID = sql`${messages.metadata} ->> 'voice_session_id'`;

const ConversationTargetSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
});

/**
 * The counter's value after an allocation moved it, which is one past the
 * position handed out. It is a 64-bit column like every instant here, so it
 * is read through the same schema they are: `@effect/sql-pg` hands an `int8`
 * back as a JS `bigint`, the `pg` driver before it as a string, PGlite as a
 * number, and a sequence position is as far inside the safe integer range as
 * a millisecond is.
 */
const SequenceSchema = Schema.Struct({ next: EpochMillisColumnSchema });

/** The message row this writer reads back to decide its next write: what stands, and whether it is closed. */
const MessageRowSchema = Schema.Struct({
  id: Schema.String,
  parts: StoredPartsColumnSchema,
  metadata: Schema.NullOr(MessageMetadataColumnSchema),
  finishedAt: Schema.NullOr(InstantColumnSchema),
});

type MessageRow = Schema.Schema.Type<typeof MessageRowSchema>;

const TurnRowSchema = Schema.Struct({
  status: TurnStatusSchema,
  queuedAt: Schema.Date,
  startedAt: Schema.NullOr(Schema.Date),
});

const MessageInsertSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  seq: Schema.Int,
  turnId: Schema.NullOr(Schema.String),
  clientId: Schema.String,
  role: MessageRoleSchema,
  parts: StoredPartsColumnSchema,
  metadata: Schema.NullOr(MessageMetadataColumnSchema),
  createdAt: Schema.Date,
  placedAt: Schema.Date,
  finishedAt: Schema.NullOr(Schema.Date),
  sender: Schema.NullOr(Schema.Literals(Object.values(MESSAGE_SENDER))),
  senderUserId: Schema.NullOr(Schema.String),
  senderName: Schema.NullOr(Schema.String),
  senderModel: Schema.NullOr(Schema.String),
  senderAgentId: Schema.NullOr(Schema.String),
});

const lockConversation = SqlSchema.findOneOption({
  Request: ConversationTargetSchema,
  Result: Schema.Struct({
    id: Schema.String,
    kind: Schema.Literals(Object.values(CONVERSATION_KIND)),
  }),
  execute: (target) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id, kind: conversations.kind })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, target.conversationId),
            eq(conversations.userId, target.userId),
            isNull(conversations.deletedAt),
          ),
        )
        .for("update"),
    ),
});

/**
 * The first position of a conversation no row of the numbered table holds.
 * The counter is moved to at least this, so a position taken outside the
 * counter costs nothing but a skip; the read is served by the unique index
 * over the table's own `(conversation_id, seq)` pair.
 */
const pastTheHighestMessageSeq = (conversationId: string) =>
  queryBuilder
    .select({ free: sql<number>`coalesce(max(${messages.seq}), 0) + 1` })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));

const allocateMessageSequence = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, now: Schema.Date }),
  Result: SequenceSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({
          nextMessageSeq: sql`greatest(${conversations.nextMessageSeq}, ${pastTheHighestMessageSeq(request.conversationId)}) + 1`,
          lastActivityAt: request.now,
        })
        .where(eq(conversations.id, request.conversationId))
        .returning({ next: conversations.nextMessageSeq }),
    ),
});

const findTurn = SqlSchema.findOneOption({
  Request: Schema.Struct({ turnId: Schema.String, conversationId: Schema.String }),
  Result: TurnRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ status: turns.status, queuedAt: turns.queuedAt, startedAt: turns.startedAt })
        .from(turns)
        .where(and(eq(turns.id, request.turnId), eq(turns.conversationId, request.conversationId))),
    ),
});

const findMessageByClientId = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, clientId: Schema.String }),
  Result: MessageRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          id: messages.id,
          parts: messages.parts,
          metadata: messages.metadata,
          finishedAt: messages.finishedAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, request.conversationId),
            eq(messages.clientId, request.clientId),
          ),
        ),
    ),
});

const insertMessageRow = SqlSchema.findOneOption({
  Request: MessageInsertSchema,
  Result: InsertedRowSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(messages)
        .values({
          userId: row.userId,
          conversationId: row.conversationId,
          seq: row.seq,
          turnId: row.turnId,
          clientId: row.clientId,
          role: row.role,
          parts: row.parts,
          metadata: row.metadata,
          createdAt: row.createdAt,
          placedAt: row.placedAt,
          finishedAt: row.finishedAt,
          sender: row.sender,
          senderUserId: row.senderUserId,
          senderName: row.senderName,
          senderModel: row.senderModel,
          senderAgentId: row.senderAgentId,
        })
        .returning({ id: messages.id, txid: CURRENT_TXID }),
    ),
});

/**
 * A write to a numbered row in place moves the conversation's journal
 * revision and stamps the row with where it moved to, in the one statement,
 * so the change signal's head moves with the write and a messages read
 * asked from an earlier revision answers exactly the rows written since.
 * The writes below that take the bump are the only ones that change a row after it is
 * numbered; a move gives a row a fresh sequence, which the sequence counter
 * already announces.
 *
 * Note that the bump is a fragment standing as the statement's own
 * data-modifying CTE rather than a builder update, because a CTE's body is
 * the one place the builder takes no statement but a select: `$with(alias,
 * selection).as()` takes the SQL, and the update around it — the row's own
 * write, and the read of what the bump landed on — is the builder's. The
 * columns the fragment names are the schema module's, so a renamed column
 * still moves it.
 */
const BUMPED_REVISION = "bumped";

const bumpedRevision = (conversationId: string) =>
  queryBuilder.$with(BUMPED_REVISION, { journalRevision: conversations.journalRevision }).as(
    sql`update ${conversations}
        set ${sql.identifier(conversations.journalRevision.name)} = ${conversations.journalRevision} + 1
        where ${eq(conversations.id, conversationId)}
        returning ${conversations.journalRevision}`,
  );

/** What the bump landed on, which is the revision the row it stamps takes. */
const landedRevision = (bumped: ReturnType<typeof bumpedRevision>) =>
  sql<number>`(select ${bumped.journalRevision} from ${bumped})`;

const updateMessageParts = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    conversationId: Schema.String,
    parts: StoredPartsColumnSchema,
  }),
  execute: (row) => {
    const bumped = bumpedRevision(row.conversationId);
    return Database.use((db) =>
      db
        .with(bumped)
        .update(messages)
        .set({ parts: row.parts, revision: landedRevision(bumped) })
        .where(eq(messages.id, row.id)),
    );
  },
});

const finishMessage = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    conversationId: Schema.String,
    parts: StoredPartsColumnSchema,
    finishedAt: Schema.Date,
  }),
  execute: (row) => {
    const bumped = bumpedRevision(row.conversationId);
    return Database.use((db) =>
      db
        .with(bumped)
        .update(messages)
        .set({
          parts: row.parts,
          finishedAt: row.finishedAt,
          revision: landedRevision(bumped),
        })
        .where(eq(messages.id, row.id)),
    );
  },
});

const completeMessage = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    conversationId: Schema.String,
    parts: StoredPartsColumnSchema,
    metadata: Schema.NullOr(MessageMetadataColumnSchema),
    finishedAt: Schema.Date,
  }),
  execute: (row) => {
    const bumped = bumpedRevision(row.conversationId);
    return Database.use((db) =>
      db
        .with(bumped)
        .update(messages)
        .set({
          parts: row.parts,
          metadata: row.metadata,
          finishedAt: row.finishedAt,
          revision: landedRevision(bumped),
        })
        .where(eq(messages.id, row.id)),
    );
  },
});

/**
 * A turn's closed journal read again once its turn has settled: nothing on
 * the row changes but its revision, so a reader past the journal's own
 * cursor finds it again beside what the settled turn row now says of it,
 * its tokens and how it ended (`turn-record.ts`).
 */
const reviseJournal = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String, conversationId: Schema.String }),
  execute: (row) => {
    const bumped = bumpedRevision(row.conversationId);
    return Database.use((db) =>
      db
        .with(bumped)
        .update(messages)
        .set({ revision: landedRevision(bumped) })
        .where(eq(messages.id, row.id)),
    );
  },
});

const insertStartedTurn = SqlSchema.void({
  Request: Schema.Struct({
    turnId: Schema.String,
    userId: Schema.String,
    conversationId: Schema.String,
    origin: TurnOriginSchema,
    startedAt: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(turns).values({
        id: row.turnId,
        userId: row.userId,
        conversationId: row.conversationId,
        origin: row.origin,
        status: TURN_STATUS.RUNNING,
        queuedAt: row.startedAt,
        startedAt: row.startedAt,
      }),
    ),
});

const insertQueuedTurn = SqlSchema.void({
  Request: Schema.Struct({
    turnId: Schema.String,
    userId: Schema.String,
    conversationId: Schema.String,
    origin: TurnOriginSchema,
    eveTurnId: Schema.NullOr(Schema.String),
    model: Schema.NullOr(Schema.String),
    reasoningEffort: Schema.NullOr(Schema.String),
    promptHash: Schema.NullOr(Schema.String),
    toolSetHash: Schema.NullOr(Schema.String),
    queuedAt: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(turns).values({
        id: row.turnId,
        userId: row.userId,
        conversationId: row.conversationId,
        origin: row.origin,
        status: TURN_STATUS.QUEUED,
        eveTurnId: row.eveTurnId,
        model: row.model,
        reasoningEffort: row.reasoningEffort,
        promptHash: row.promptHash,
        toolSetHash: row.toolSetHash,
        queuedAt: row.queuedAt,
      }),
    ),
});

const startTurn = SqlSchema.void({
  Request: Schema.Struct({ turnId: Schema.String, startedAt: Schema.Date }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({ status: TURN_STATUS.RUNNING, startedAt: row.startedAt })
        .where(eq(turns.id, row.turnId)),
    ),
});

/**
 * Note that the response ids no longer need the empty array written as a
 * literal: a driver infers a parameter's Postgres type from the value it is
 * handed and an empty array offers no element to infer one from, but a
 * `text[]` column renders its own value as the array literal it is, so the
 * ordinary case — a turn that called nothing and settles with no response
 * ids — is one more bound parameter.
 */
const settleTurn = SqlSchema.void({
  Request: Schema.Struct({
    turnId: Schema.String,
    status: TurnStatusSchema,
    settledAt: Schema.Date,
    failure: Schema.NullOr(Schema.String),
    failureDetail: Schema.NullOr(Schema.String),
    usage: Schema.NullOr(TurnUsageColumnSchema),
    responseIds: Schema.Array(Schema.String),
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          status: row.status,
          settledAt: row.settledAt,
          failure: row.failure,
          failureDetail: row.failureDetail,
          usage: row.usage,
          responseIds: [...row.responseIds],
        })
        .where(eq(turns.id, row.turnId)),
    ),
});

function pendingToolPart(name: string, callId: string, input: UnparsedWireValue): ToolPart {
  return {
    type: toolPartType(name),
    toolCallId: callId,
    state: TOOL_PART_STATE.INPUT_AVAILABLE,
    input,
  };
}

/**
 * Why the record settled a call nothing answered: its turn ended or was
 * cancelled first, or eve ran the step that asked for it again.
 */
const UNANSWERED_REASON = {
  ENDED: "The turn ended before the call answered; it may have run.",
  CANCELLED: "The turn was cancelled before the call answered; it may have run.",
  RETRIED:
    "The step that asked for the call was run again before the call answered; it may have run.",
} as const;

type UnansweredReason = (typeof UNANSWERED_REASON)[keyof typeof UNANSWERED_REASON];

/**
 * A call nothing will answer, settled as the one thing the record can
 * truthfully say of it: the call was dispatched and its effect is unknown,
 * an answer whose envelope says so, never an error, which would read as a
 * refusal and license doing it again.
 */
function unansweredToolPart(part: StoredToolPart, reason: UnansweredReason): ToolPart {
  return {
    type: part.type,
    toolCallId: part.toolCallId,
    state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
    input: part.input,
    output: unknownOutcome(reason),
  };
}

/**
 * The reasoning part the stream's summary amounts to while the turn runs: the
 * summary's words under the provider item's own id, read for identity alone
 * so a summary told twice is one part. The completed message's projection
 * carries the item's replay data in the provider's own slot and replaces this
 * part when the turn answers.
 */
function reasoningPart(summary: string, id: string): ReasoningUIPart {
  return { type: UI_PART_TYPE.REASONING, id, text: summary, state: UI_PART_STATE.DONE };
}

function toolPartOf(
  parts: Parts,
  callId: string,
): { index: number; part: StoredToolPart } | undefined {
  const index = parts.findIndex((part) => isStoredToolPart(part) && part.toolCallId === callId);
  const part = parts[index];
  return part !== undefined && isStoredToolPart(part) ? { index, part } : undefined;
}

/** A turn's journal as this locked write last read or amended it, and whether an amendment is still to land. */
interface HeldJournal {
  readonly row: MessageRow;
  readonly dirty: boolean;
}

interface WriterContext {
  readonly tools: ToolSet;
  /** The instant this locked write stamps every row it touches. */
  readonly now: Date;
  readonly target: ConversationTarget;
  /** What the conversation is: a coding agent's own, whose failed turn keeps its words, or one of the brain's. */
  readonly kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];
  /**
   * The journals this locked write has read, by their turn's id, each as it
   * now stands in the write: read once, amended here, and written once as
   * the write ends (`landJournals`), so a batch of events moves a journal's
   * parts and its revision once however many of them grew it.
   */
  readonly journals: Map<string, HeldJournal>;
  /**
   * The notices this write's coding agent turns that settled leave for its
   * member's operator, each written once the write's transaction is done
   * (`noticesAfterSettle`), by the kind it is and when it settled.
   */
  readonly notices: { kind: OperatorNoticeKind; at: Date }[];
  /**
   * The coding agent turns this write settled, each told the runtime's
   * `SettledTurnListener` once the write's transaction is done
   * (`settledAfterCommit`).
   */
  readonly settled: SettledAgentTurn[];
}

/** What a locked write leaves for once its transaction is done. */
type AfterCommit = Pick<WriterContext, "notices" | "settled">;

/** What one of this writer's statements answers: an effect over the transaction it runs in. */
type Write<Result> = Effect.Effect<Result, StoreFailure, DatabaseServices>;

type Admitted = Result.Result<StoredUIMessage, MessageRefused>;

/**
 * Holds one message to the vocabulary before it lands, exactly as a read
 * holds a stored row: the SDK's structure, the registered tools and their
 * input schemas, this build's metadata by role and its tool-state set. The
 * row lands as JSON, so the JSON shape is what is held: a field the
 * serialization drops was never going to be stored.
 */
function admitted(
  context: WriterContext,
  message: UIMessage | StoredUIMessage,
): Effect.Effect<Admitted> {
  return Effect.flatMap(
    readStoredUIMessages(jsonRoundTrip([message]), context.tools),
    (read): Effect.Effect<Admitted> => {
      if (!read.ok) {
        return Effect.succeed(
          Result.fail({
            refusal: STORE_WRITE_REFUSAL.MESSAGE_REFUSED,
            reason: read.refusal,
            path: read.path,
          }),
        );
      }
      const [stored] = read.value;
      return stored === undefined
        ? Effect.die(new Error("the reader answered no row for one message"))
        : Effect.succeed(Result.succeed(stored));
    },
  );
}

/**
 * The next position of the conversation's message sequence: the counter's
 * own, or one past the highest position a row already holds where the
 * counter fell behind it, and the counter moved past whichever was handed
 * out. The read of `max(seq)` is served by the unique index over the pair.
 */
const allocateMessageSeq = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
): Effect.fn.Return<number, StoreFailure, DatabaseServices> {
  const row = yield* allocateMessageSequence({
    conversationId: context.target.conversationId,
    now: context.now,
  });
  const allocated = yield* required(row, "the conversation vanished under its own lock");
  return allocated.next - 1;
});

function turnRow(
  context: WriterContext,
  turnId: string,
): Write<Option.Option<typeof TurnRowSchema.Type>> {
  return findTurn({ turnId, conversationId: context.target.conversationId });
}

function messageByClientId(
  context: WriterContext,
  clientId: string,
): Write<Option.Option<MessageRow>> {
  return findMessageByClientId({
    conversationId: context.target.conversationId,
    clientId,
  });
}

/**
 * The turn's journal as this write holds it: the row read once by its
 * client id, then whatever the write has made of it since, so the events of
 * one batch read what the ones before them amended rather than the row as
 * it last landed.
 */
function journalRow(context: WriterContext, turnId: string): Write<Option.Option<MessageRow>> {
  const held = context.journals.get(turnId);
  if (held !== undefined) return Effect.succeed(Option.some(held.row));
  return Effect.tap(messageByClientId(context, turnId), (read) =>
    Effect.sync(() => {
      if (Option.isSome(read)) context.journals.set(turnId, { row: read.value, dirty: false });
    }),
  );
}

/** Keeps what the write made of the turn's journal: an amendment still to land, or a row a statement already wrote. */
function holdJournal(context: WriterContext, turnId: string, row: MessageRow, dirty: boolean) {
  context.journals.set(turnId, { row, dirty });
}

/** The conversations whose journal is a transcript a coding agent's tab shows: its own and its workers'. */
const TRANSCRIPT_KINDS: ReadonlySet<string> = new Set([
  CONVERSATION_KIND.AGENT,
  CONVERSATION_KIND.CHILD,
]);

/**
 * What a transcript's journal growth costs to write: each amendment that
 * lands rewrites the turn's whole journal row, so its bytes climb with the
 * turn's length. Sentry's metrics layer sends it as the histogram's `.sum`,
 * `.count`, `.min`, and `.max`. It carries a size and never a row, an id, or
 * a txid.
 */
const JOURNAL_METRIC = {
  REWRITE_BYTES: Metric.histogram("luke.transcript.journal_rewrite_bytes", {
    description: "Bytes of parts a landed journal amendment wrote, as the row's whole parts",
    boundaries: Metric.exponentialBoundaries({ start: 1024, factor: 2, count: 12 }),
  }),
} as const;

/**
 * Lands every journal the write amended, each in one statement that moves
 * the conversation's journal revision once: the parts as the last amendment
 * left them. A journal a later statement of the same write already wrote
 * whole (its answer, its end) has nothing left to land.
 */
function landJournals(context: WriterContext): Write<void> {
  return Effect.forEach(
    [...context.journals.entries()],
    ([turnId, held]) =>
      held.dirty
        ? Effect.andThen(
            updateMessageParts({
              id: held.row.id,
              conversationId: context.target.conversationId,
              parts: held.row.parts,
            }),
            Effect.andThen(
              // Note that only a coding agent's journal, or its worker's, is counted, since its transcript is what the measure is for; a child conversation is only ever opened for a worker (`openChildConversation`).
              TRANSCRIPT_KINDS.has(context.kind)
                ? Metric.update(
                    JOURNAL_METRIC.REWRITE_BYTES,
                    Buffer.byteLength(JSON.stringify(held.row.parts)),
                  )
                : Effect.void,
              Effect.sync(() => holdJournal(context, turnId, held.row, false)),
            ),
          )
        : Effect.void,
    { discard: true },
  );
}

/** Where a row landed: its id, and the position it took. */
interface InsertedMessage {
  readonly id: string;
  readonly seq: number;
  /** The transaction that wrote the row. */
  readonly txid: string;
}

const insertMessage = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  row: {
    clientId: string;
    turnId: string | undefined;
    message: StoredUIMessage;
    finishedAt: Date | undefined;
    /** What sent a developer's line to a coding agent; none for every other row. */
    sender?: LineSender;
  },
): Effect.fn.Return<InsertedMessage, StoreFailure, DatabaseServices> {
  const seq = yield* allocateMessageSeq(context);
  const metadata: StoredMessageMetadata | undefined =
    row.message.role === MESSAGE_ROLE.SYSTEM ? undefined : row.message.metadata;
  const createdAt = context.now;
  const inserted = yield* insertMessageRow({
    userId: context.target.userId,
    conversationId: context.target.conversationId,
    seq,
    turnId: nullable(row.turnId),
    clientId: row.clientId,
    role: row.message.role,
    parts: row.message.parts,
    metadata: nullable(metadata),
    createdAt,
    placedAt: createdAt,
    finishedAt: nullable(row.finishedAt),
    sender: nullable(row.sender?.kind),
    senderUserId: row.sender?.kind === MESSAGE_SENDER.MEMBER ? row.sender.userId : null,
    senderName: senderNameOf(row.sender),
    senderModel: row.sender?.kind === MESSAGE_SENDER.AGENT ? row.sender.model : null,
    senderAgentId: row.sender?.kind === MESSAGE_SENDER.AGENT ? row.sender.agentId : null,
  });
  const written = yield* required(inserted, "the message insert answered no row");
  return { id: written.id, seq, txid: written.txid };
});

type Journal = Result.Result<
  MessageRow,
  Refused<typeof STORE_WRITE_REFUSAL.NO_TURN | typeof STORE_WRITE_REFUSAL.FINISHED>
>;

/** Whether a turn may still take a new message or part: it stands, and it has not ended. */
function openTurn(
  context: WriterContext,
  turnId: string,
): Write<
  Option.Option<Refused<typeof STORE_WRITE_REFUSAL.NO_TURN | typeof STORE_WRITE_REFUSAL.FINISHED>>
> {
  return Effect.map(turnRow(context, turnId), (turn) => {
    if (Option.isNone(turn)) return Option.some(NO_TURN);
    if (TERMINAL_TURN_STATUSES.has(turn.value.status)) {
      return Option.some({ refusal: STORE_WRITE_REFUSAL.FINISHED } as const);
    }
    return Option.none();
  });
}

/**
 * The turn's one assistant message, the journal of the turn under way: keyed
 * by the turn's id as its client id, opened by the first part the turn
 * reports while the turn still runs, and closed by the turn's answer or its
 * end. A turn that has ended opens no journal after the fact.
 */
const journal = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  turnId: string,
): Effect.fn.Return<Journal, StoreFailure, DatabaseServices> {
  const standing = yield* journalRow(context, turnId);
  if (Option.isSome(standing)) return Result.succeed(standing.value);
  const closed = yield* openTurn(context, turnId);
  if (Option.isSome(closed)) return Result.fail(closed.value);
  const { id } = yield* insertMessage(context, {
    clientId: turnId,
    turnId,
    message: { id: turnId, role: MESSAGE_ROLE.ASSISTANT, metadata: MODEL_AUTHORED, parts: [] },
    finishedAt: undefined,
  });
  const opened: MessageRow = { id, parts: [], metadata: MODEL_AUTHORED, finishedAt: null };
  holdJournal(context, turnId, opened, false);
  return Result.succeed(opened);
});

/**
 * Takes the journal's parts as they now stand, held to the vocabulary first.
 * They land as the locked write ends (`landJournals`), once for every
 * amendment the write made, so an amendment the vocabulary refused never
 * stands and one it took is written with whatever followed it.
 */
const amendJournal = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  turnId: string,
  row: MessageRow,
  parts: Parts,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const read = yield* admitted(context, {
    id: row.id,
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: MODEL_AUTHORED,
    parts,
  });
  if (Result.isFailure(read)) return Result.fail(read.failure);
  holdJournal(context, turnId, { ...row, parts: read.success.parts }, true);
  return Result.succeed(STORE_WRITE_EFFECT.WRITTEN);
});

const turnStarted = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  event: Extract<RunEvent, { kind: typeof RUN_EVENT.TURN_STARTED }>,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const standing = yield* turnRow(context, event.turnId);
  const startedAt = new Date(event.at);
  if (Option.isNone(standing)) {
    yield* insertStartedTurn({
      turnId: event.turnId,
      userId: context.target.userId,
      conversationId: context.target.conversationId,
      origin: TURN_ORIGIN_OF_RUN_ORIGIN[event.origin],
      startedAt,
    });
    return Result.succeed(STORE_WRITE_EFFECT.WRITTEN);
  }
  if (standing.value.status !== TURN_STATUS.QUEUED) {
    return Result.succeed(STORE_WRITE_EFFECT.REPEATED);
  }
  yield* startTurn({ turnId: event.turnId, startedAt });
  return Result.succeed(STORE_WRITE_EFFECT.WRITTEN);
});

const turnEnded = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  event: Extract<RunEvent, { kind: typeof RUN_EVENT.TURN_ENDED }>,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const standing = yield* turnRow(context, event.turnId);
  if (Option.isNone(standing)) return Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_TURN });
  if (TERMINAL_TURN_STATUSES.has(standing.value.status)) {
    return Result.succeed(STORE_WRITE_EFFECT.REPEATED);
  }
  const settledAt = new Date(event.at);
  const status = turnStatusOf(event.status);
  // A failed turn names its failure word where the run had one, and the status
  // it ended in otherwise, so a timed-out or interrupted turn still says which.
  const failure = event.failure ?? (status === TURN_STATUS.FAILED ? event.status : undefined);
  yield* settleTurn({
    turnId: event.turnId,
    status,
    settledAt,
    failure: nullable(failure),
    failureDetail: nullable(event.failureDetail?.slice(0, TURN_FAILURE_DETAIL.CHARS)),
    usage: nullable(
      event.usage === undefined
        ? undefined
        : {
            ...event.usage,
            ...(event.usageByModel === undefined ? undefined : { byModel: event.usageByModel }),
          },
    ),
    responseIds: event.responseIds,
  });
  // A coding agent's own turn that settled is told its member's operator, once the write is done.
  if (context.kind === CONVERSATION_KIND.AGENT) {
    const kind =
      status === TURN_STATUS.FAILED
        ? OPERATOR_NOTICE_KIND.TURN_FAILED
        : OPERATOR_NOTICE_KIND.TURN_SETTLED;
    context.notices.push({ kind, at: settledAt });
    const { startedAt, queuedAt } = standing.value;
    context.settled.push({
      userId: context.target.userId,
      conversationId: context.target.conversationId,
      turnId: event.turnId,
      status,
      failure: failure ?? null,
      ranMs: Math.max(0, settledAt.getTime() - (startedAt ?? queuedAt).getTime()),
    });
  }
  // A journal still open here belongs to a turn that answered nothing. A
  // brain's keeps what it did and the words its steps formed leave it,
  // because a new session's seed reads them as said and the voice could
  // speak them. A coding agent's keeps its words as well, because they are
  // the partial work its tab shows and a Continue or a Fork replays. One
  // the answer already closed is revised in place, because a reader may
  // have taken it before the row settled, and what the row now says of it
  // travels with it.
  const open = yield* journalRow(context, event.turnId);
  if (Option.isSome(open) && open.value.finishedAt !== null) {
    yield* reviseJournal({ id: open.value.id, conversationId: context.target.conversationId });
  }
  if (Option.isSome(open) && open.value.finishedAt === null) {
    const reason =
      event.status === RUN_STATUS.CANCELLED ? UNANSWERED_REASON.CANCELLED : UNANSWERED_REASON.ENDED;
    const keepsWords = context.kind === CONVERSATION_KIND.AGENT;
    const parts = open.value.parts.flatMap((part): Parts => {
      if (part.type === UI_PART_TYPE.TEXT) return keepsWords ? [part] : [];
      return isStoredToolPart(part) && !isSettledToolPartState(part.state)
        ? [unansweredToolPart(part, reason)]
        : [part];
    });
    yield* finishMessage({
      id: open.value.id,
      conversationId: context.target.conversationId,
      parts,
      finishedAt: settledAt,
    });
    holdJournal(context, event.turnId, { ...open.value, parts, finishedAt: settledAt }, false);
  }
  return Result.succeed(STORE_WRITE_EFFECT.WRITTEN);
});

/** The newest step's calls still unanswered, settled as an abandoned attempt's, and a coding agent's words of that attempt dropped; a journal with neither, or closed, is a repeat. */
const settleRetriedCalls = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  turnId: string,
  row: MessageRow,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const boundary = row.parts.findLastIndex((part) => part.type === UI_PART_TYPE.STEP_START);
  // Note that a coding agent's abandoned words leave with the attempt, since its failed turn keeps its words and the retry's own, which may be shorter, could not replace them.
  const dropsWords = context.kind === CONVERSATION_KIND.AGENT;
  const parts = row.parts.flatMap((part, index): Parts => {
    if (index <= boundary) return [part];
    if (dropsWords && part.type === UI_PART_TYPE.TEXT) return [];
    return isStoredToolPart(part) && !isSettledToolPartState(part.state)
      ? [unansweredToolPart(part, UNANSWERED_REASON.RETRIED)]
      : [part];
  });
  const settled =
    parts.length !== row.parts.length || parts.some((part, index) => part !== row.parts[index]);
  if (!settled || row.finishedAt !== null) return Result.succeed(STORE_WRITE_EFFECT.REPEATED);
  return yield* amendJournal(context, turnId, row, parts);
});

/**
 * A step joins the journal as the boundary before its parts. Steps are
 * counted, not named, so the journal's own count of boundaries is what tells
 * a step told twice from the next one: a step the journal already holds is a
 * repeat, and any later step appends one boundary, whatever the stream
 * dropped between. The turn's completed projection replaces the journal
 * whole, boundaries and all, when the turn answers.
 *
 * The newest step told again is eve running it again. A step interrupted
 * part way re-runs whole, asking the model afresh, while whatever the first
 * attempt wrote stays on the stream, and the relay's state rolls back with
 * the step, so the relay tells its boundary a second time. Every call past
 * that boundary still unanswered is then the abandoned attempt's, which
 * nothing will answer, so it is settled here as a turn's end settles one,
 * rather than left running until the turn ends, which for a coding agent is
 * its whole run: a worker such a call delegated reads as starting until then.
 * A coding agent's words of the abandoned attempt leave the step too, since
 * the model never read them and the new attempt drafts its own, so a turn
 * that then fails keeps the words of the attempt it failed on.
 * Note that a call the new attempt asks for again under the same id finds it
 * settled, which no provider's fresh answer does, since each mints its own.
 */
const stepStarted = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  event: Extract<RunEvent, { kind: typeof RUN_EVENT.STEP_STARTED }>,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const opened = yield* journal(context, event.turnId);
  if (Result.isFailure(opened)) return Result.fail(opened.failure);
  const row = opened.success;
  const held = row.parts.filter((part) => part.type === UI_PART_TYPE.STEP_START).length;
  if (held > event.step) return Result.succeed(STORE_WRITE_EFFECT.REPEATED);
  if (held === event.step) return yield* settleRetriedCalls(context, event.turnId, row);
  if (row.finishedAt !== null) return Result.fail({ refusal: STORE_WRITE_REFUSAL.FINISHED });
  return yield* amendJournal(context, event.turnId, row, [...row.parts, STEP_START_PART]);
});

const toolCallStarted = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  event: Extract<RunEvent, { kind: typeof RUN_EVENT.TOOL_CALL_STARTED }>,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const opened = yield* journal(context, event.turnId);
  if (Result.isFailure(opened)) return Result.fail(opened.failure);
  const row = opened.success;
  if (toolPartOf(row.parts, event.callId) !== undefined) {
    return Result.succeed(STORE_WRITE_EFFECT.REPEATED);
  }
  if (row.finishedAt !== null) return Result.fail({ refusal: STORE_WRITE_REFUSAL.FINISHED });
  return yield* amendJournal(context, event.turnId, row, [
    ...row.parts,
    pendingToolPart(event.name, event.callId, event.input),
  ]);
});

const toolCallSettled = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  event: Extract<RunEvent, { kind: typeof RUN_EVENT.TOOL_CALL_SETTLED }>,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const standing = yield* journalRow(context, event.turnId);
  if (Option.isNone(standing)) {
    const turn = yield* turnRow(context, event.turnId);
    return Result.fail({
      refusal: Option.isNone(turn) ? STORE_WRITE_REFUSAL.NO_TURN : STORE_WRITE_REFUSAL.NO_CALL,
    });
  }
  const row = standing.value;
  const found = toolPartOf(row.parts, event.callId);
  if (found === undefined) return Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_CALL });
  // Note that an input told with the settlement replaces the one the start
  // recorded, in the same write, so the call stands as it answered.
  const settled = settledToolPart(
    event.input === undefined ? found.part : { ...found.part, input: event.input },
    event.settlement,
  );
  // A call settles once. The same settlement told again is a repeat; a
  // different one, after the turn's end already settled the call as
  // unanswered, finds the call closed and is refused rather than rewritten.
  if (isSettledToolPartState(found.part.state)) {
    return isDeepStrictEqual(settled, found.part)
      ? Result.succeed(STORE_WRITE_EFFECT.REPEATED)
      : Result.fail({ refusal: STORE_WRITE_REFUSAL.FINISHED });
  }
  if (row.finishedAt !== null) return Result.fail({ refusal: STORE_WRITE_REFUSAL.FINISHED });
  const parts = [...row.parts];
  parts[found.index] = settled;
  return yield* amendJournal(context, event.turnId, row, parts);
});

/**
 * A reasoning summary joins the journal under its item's id. An item that
 * names no id is not journaled: nothing could tell its second delivery from
 * a second item, and the turn's completed projection carries every summary
 * under the id the adapter lifted for it.
 */
const reasoningCompleted = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  event: Extract<RunEvent, { kind: typeof RUN_EVENT.REASONING_COMPLETED }>,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const { id } = event.item;
  if (!isWireString(id)) return Result.succeed(STORE_WRITE_EFFECT.IGNORED);
  const opened = yield* journal(context, event.turnId);
  if (Result.isFailure(opened)) return Result.fail(opened.failure);
  const row = opened.success;
  if (row.parts.some((part) => part.type === UI_PART_TYPE.REASONING && part.id === id)) {
    return Result.succeed(STORE_WRITE_EFFECT.REPEATED);
  }
  if (row.finishedAt !== null) return Result.fail({ refusal: STORE_WRITE_REFUSAL.FINISHED });
  return yield* amendJournal(context, event.turnId, row, [
    ...row.parts,
    reasoningPart(event.summary, id),
  ]);
});

/**
 * A step's words so far join the journal as the one text part of that step,
 * written in place as they grow, so the voice can say a finished sentence
 * while the turn still runs. The words only grow: what the part already
 * holds, or more, is a repeat. A step the journal holds no boundary for is
 * not the journal's, and its words are left to the completed answer.
 */
const textDrafted = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  event: Extract<RunEvent, { kind: typeof RUN_EVENT.TEXT_DRAFTED }>,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const opened = yield* journal(context, event.turnId);
  if (Result.isFailure(opened)) return Result.fail(opened.failure);
  const row = opened.success;
  if (row.finishedAt !== null) return Result.fail({ refusal: STORE_WRITE_REFUSAL.FINISHED });
  const boundaries = row.parts.flatMap((part, index) =>
    part.type === UI_PART_TYPE.STEP_START ? [index] : [],
  );
  const start = boundaries[event.step - 1];
  if (start === undefined) return Result.succeed(STORE_WRITE_EFFECT.IGNORED);
  const end = boundaries[event.step] ?? row.parts.length;
  const at = row.parts.findIndex(
    (part, index) => index > start && index < end && part.type === UI_PART_TYPE.TEXT,
  );
  const held = row.parts[at];
  if (held?.type === UI_PART_TYPE.TEXT && held.text.length >= event.text.length) {
    return Result.succeed(STORE_WRITE_EFFECT.REPEATED);
  }
  const part = { type: UI_PART_TYPE.TEXT, text: event.text, state: UI_PART_STATE.DONE } as const;
  const parts = [...row.parts];
  if (at === -1) parts.splice(end, 0, part);
  else parts[at] = part;
  return yield* amendJournal(context, event.turnId, row, parts);
});

/**
 * A completed message: a user message lands as its own row by its id; the
 * turn's answer closes the turn's journal, its parts replaced whole by the
 * projection the turn told, since the projection is the message as the
 * runtime's own record has it and the journal was the record of it in flight.
 * A journal anything followed while the turn ran — Luke's words said around
 * the ask as the brain worked, an aside, a second line of the developer's —
 * closes at a fresh position behind them, so the thread reads as it was
 * heard: what was said while he worked, then what he did and thought, then
 * what was said of it. A journal nothing followed keeps its place. A closed
 * journal takes the same projection again as a repeat and a different one as
 * the late write it is.
 */
const messageCompleted = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  event: Extract<RunEvent, { kind: typeof RUN_EVENT.MESSAGE_COMPLETED }>,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const read = yield* admitted(context, event.message);
  if (Result.isFailure(read)) return Result.fail(read.failure);
  const message = read.success;
  if (message.role !== MESSAGE_ROLE.ASSISTANT) {
    const standing = yield* messageByClientId(context, message.id);
    if (Option.isSome(standing)) return Result.succeed(STORE_WRITE_EFFECT.REPEATED);
    const closed = yield* openTurn(context, event.turnId);
    if (Option.isSome(closed)) return Result.fail(closed.value);
    yield* insertMessage(context, {
      clientId: message.id,
      turnId: event.turnId,
      message,
      finishedAt: context.now,
    });
    return Result.succeed(STORE_WRITE_EFFECT.WRITTEN);
  }
  const opened = yield* journal(context, event.turnId);
  if (Result.isFailure(opened)) return Result.fail(opened.failure);
  const row = opened.success;
  if (row.finishedAt !== null) {
    return isDeepStrictEqual(row.parts, message.parts)
      ? Result.succeed(STORE_WRITE_EFFECT.REPEATED)
      : Result.fail({ refusal: STORE_WRITE_REFUSAL.FINISHED });
  }
  yield* completeMessage({
    id: row.id,
    conversationId: context.target.conversationId,
    parts: message.parts,
    metadata: nullable(message.metadata),
    finishedAt: context.now,
  });
  // The answer replaces the journal whole, so an amendment this write held for it has nothing left to land.
  holdJournal(
    context,
    event.turnId,
    {
      id: row.id,
      parts: message.parts,
      metadata: nullable(message.metadata),
      finishedAt: context.now,
    },
    false,
  );
  yield* moveJournalBehindWhatFollowed(context, row.id);
  return Result.succeed(STORE_WRITE_EFFECT.WRITTEN);
});

/**
 * The closed journal follows whatever landed after it while its turn ran:
 * where a row of the conversation stands past it, the journal moves to a
 * fresh position — past every device's cursor, so a device that previewed
 * the journal reads it again where it now stands and lets the copy go —
 * and where nothing does, it stays where it opened and moves no sequence.
 */
function moveJournalBehindWhatFollowed(context: WriterContext, id: string): Write<void> {
  return Effect.gen(function* () {
    const followed = yield* findMessageFollowing({
      conversationId: context.target.conversationId,
      id,
    });
    if (Option.isNone(followed)) return;
    yield* moveMessage({ id, seq: yield* allocateMessageSeq(context) });
  });
}

function consume(context: WriterContext, event: RunEvent): Write<StoreWriteResult> {
  switch (event.kind) {
    case RUN_EVENT.TURN_STARTED:
      return turnStarted(context, event);
    case RUN_EVENT.TURN_ENDED:
      return turnEnded(context, event);
    case RUN_EVENT.STEP_STARTED:
      return stepStarted(context, event);
    case RUN_EVENT.TOOL_CALL_STARTED:
      return toolCallStarted(context, event);
    case RUN_EVENT.TOOL_CALL_SETTLED:
      return toolCallSettled(context, event);
    case RUN_EVENT.REASONING_COMPLETED:
      return reasoningCompleted(context, event);
    case RUN_EVENT.MESSAGE_COMPLETED:
      return messageCompleted(context, event);
    case RUN_EVENT.TEXT_DRAFTED:
      return textDrafted(context, event);
    // The rest of the stream is the relay's, about a run's moments rather
    // than the record.
    case RUN_EVENT.SLOW_STEP:
    case RUN_EVENT.QUESTION_QUEUED:
    case RUN_EVENT.QUESTION_WITHDRAWN:
    case RUN_EVENT.CALL_ENDING:
    case RUN_EVENT.ACTIONS_SETTLED:
    case RUN_EVENT.REPLY_SENTENCE:
    case RUN_EVENT.ENDED:
      return Effect.succeed(Result.succeed(STORE_WRITE_EFFECT.IGNORED));
  }
}

const enqueueTurn = /* @__PURE__ */ Effect.fn("web/enqueueTurn")(function* (
  context: WriterContext,
  enqueue: TurnEnqueue,
): Effect.fn.Return<TurnEnqueueResult, StoreFailure, DatabaseServices> {
  const turnId = enqueue.turnId ?? randomUUID();
  if (Option.isSome(yield* turnRow(context, turnId))) {
    return Result.succeed({ turnId, effect: STORE_WRITE_EFFECT.REPEATED });
  }
  yield* insertQueuedTurn({
    turnId,
    userId: context.target.userId,
    conversationId: context.target.conversationId,
    origin: enqueue.origin,
    eveTurnId: nullable(enqueue.eveTurnId),
    model: nullable(enqueue.model),
    reasoningEffort: nullable(enqueue.reasoningEffort),
    promptHash: nullable(enqueue.promptHash),
    toolSetHash: nullable(enqueue.toolSetHash),
    queuedAt: context.now,
  });
  return Result.succeed({ turnId, effect: STORE_WRITE_EFFECT.WRITTEN });
});

/** A row of the conversation and the rows standing past it: one table under the two names the join reads it by. */
const placed = alias(messages, "placed");
const later = alias(messages, "later");

/** The first row of the conversation standing past one row's position, where any does. */
const findMessageFollowing = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, id: Schema.String }),
  Result: RowIdSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ id: later.id })
        .from(placed)
        .innerJoin(
          later,
          and(eq(later.conversationId, placed.conversationId), gt(later.seq, placed.seq)),
        )
        .where(and(eq(placed.conversationId, key.conversationId), eq(placed.id, key.id)))
        .orderBy(asc(later.seq))
        .limit(1),
    ),
});

const moveMessage = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String, seq: Schema.Int }),
  execute: (row) =>
    Database.use((db) => db.update(messages).set({ seq: row.seq }).where(eq(messages.id, row.id))),
});

/**
 * The developer's lines of the conversation awaiting a turn, oldest first:
 * the user rows no turn owns, of a coding agent's conversation, which is
 * the one kind whose developer lines are written ahead of their turn; an
 * old task conversation's turnless user rows are its spoken asks, attached
 * by their own writer, and never match here. A line a turn already received
 * under another row awaits nothing and is not offered (`noReceiptOfLine`).
 */
const findAwaitingLines = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: Schema.Struct({
    id: Schema.String,
    clientId: Schema.String,
    parts: StoredPartsColumnSchema,
    withdrawn: Schema.Boolean,
  }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({
          id: messages.id,
          clientId: messages.clientId,
          parts: messages.parts,
          withdrawn: sql<boolean>`${messages.withdrawnAt} is not null`,
        })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            eq(messages.conversationId, key.conversationId),
            eq(conversations.kind, CONVERSATION_KIND.AGENT),
            eq(messages.role, MESSAGE_ROLE.USER),
            isNull(messages.turnId),
            // A line typed into a call is its ask's, taken in by the ask's id and never by its words.
            sql`${SPOKEN_VOICE_SESSION_ID} is null`,
            noReceiptOfLine(),
          ),
        )
        .orderBy(asc(messages.seq)),
    ),
});

/** A line taken by the turn that received it: the turn on the row in place, with the steps it had begun before it, its revision moved, and a withdrawn line standing again. */
const giveLineToTurn = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    conversationId: Schema.String,
    turnId: Schema.String,
    takenAfterStep: Schema.NullOr(Schema.Int),
  }),
  execute: (row) => {
    const bumped = bumpedRevision(row.conversationId);
    return Database.use((db) =>
      db
        .with(bumped)
        .update(messages)
        .set({
          turnId: row.turnId,
          takenAfterStep: row.takenAfterStep,
          revision: landedRevision(bumped),
          withdrawnAt: null,
        })
        .where(eq(messages.id, row.id)),
    );
  },
});

/**
 * The steps a turn's journal has begun, which a line the turn takes now
 * arrived after; none where no journal stands yet, as for the line that
 * opened the turn. Note that eve hands a steer to the step it is about to
 * start, so the boundaries already standing are the steps before it.
 */
const stepsBegun = (context: WriterContext, turnId: string): Write<number | null> =>
  Effect.map(journalRow(context, turnId), (journal) => {
    if (Option.isNone(journal)) return null;
    const steps = journal.value.parts.filter((part) => part.type === UI_PART_TYPE.STEP_START);
    return steps.length === 0 ? null : steps.length;
  });

/**
 * The oldest run of consecutive awaiting lines whose parts, joined as eve
 * coalesces them, are the parts received; none where no run matches. A
 * line's parts are its words and the files it carried, as eve was handed
 * them (`attached-files.ts`). Note
 * that the run is read oldest first, because every send is a steer eve
 * receives in the order sent, so two lines sharing their words are taken in
 * that order.
 */
function coalescedRun<Row extends { readonly parts: Parts }>(
  awaiting: readonly Row[],
  received: string,
): readonly Row[] {
  for (let start = 0; start < awaiting.length; start += 1) {
    const pieces: string[] = [];
    for (const [offset, row] of awaiting.slice(start).entries()) {
      const parts = receivedPartsOf(row.parts);
      if (parts === undefined) break;
      pieces.push(...parts);
      const joined = pieces.join(COALESCED_LINE_SEPARATOR);
      if (joined === received) return awaiting.slice(start, start + offset + 1);
      // A run whose words already part from the received ones grows no closer by a longer run.
      if (!received.startsWith(joined)) break;
    }
  }
  return [];
}

/**
 * The dispatch run to its answer or its deadline, from inside the
 * uninterruptible write: the dispatch is forked as a root fiber of its own,
 * which is interruptible as the write is not, and a second fiber interrupts
 * it at the deadline; one interrupted that way answered nothing, which is
 * logged under the conversation's id, since its sender is answered only that
 * the service was unavailable.
 */
function dispatchedWithinDeadline(
  dispatch: Effect.Effect<boolean>,
  conversationId: string,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const running = yield* Effect.forkDetach(dispatch);
    const deadline = yield* Effect.forkDetach(
      Effect.andThen(Effect.sleep(AWAITING_LINE_DISPATCH_DEADLINE), Fiber.interrupt(running)),
    );
    const exit = yield* Fiber.await(running);
    yield* Fiber.interrupt(deadline);
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
      yield* Effect.logError("a line's hand-over ran past its deadline and is read as not taken", {
        deadline: Duration.format(AWAITING_LINE_DISPATCH_DEADLINE),
      }).pipe(Effect.annotateLogs({ conversationId }));
      return false;
    }
    return yield* exit;
  });
}

/** A line's row written and the dispatch claim its hand-over runs under; or the row a send under the same key already wrote. */
type LineClaimed = Result.Result<
  | { readonly id: string; readonly txid: string; readonly claim: string }
  | { readonly id: string; readonly effect: typeof STORE_WRITE_EFFECT.REPEATED },
  typeof NO_CONVERSATION | typeof CONVERSATION_BUSY | MessageRefused
>;

/**
 * The line's row and the conversation's dispatch claim, written together
 * under the row lock before the line is handed over, so the take of the line
 * into the turn its runtime opens finds it standing (`dispatch-claim.ts`).
 * Another hand-over's claim standing fails the write as `DispatchClaimHeld`,
 * nothing written, for the caller to try again; it is read before the repeat
 * check, so a retry of a send still under way waits for it to be recorded
 * rather than answering a row its hand-over may yet withdraw.
 */
const claimLine = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  line: AwaitingLineWrite,
  place: number,
): Effect.fn.Return<LineClaimed, StoreFailure | DispatchClaimHeld, DatabaseServices> {
  if (yield* dispatchClaimStands(context.target.conversationId, place)) {
    return yield* new DispatchClaimHeld();
  }
  const clientId = sentLineId(line.clientKey);
  yield* deleteWithdrawnLine({ conversationId: context.target.conversationId, clientId });
  // A line already under the key is the send a lost answer was for: eve has it, and hears nothing again.
  const standing = yield* messageByClientId(context, clientId);
  if (Option.isSome(standing)) {
    return Result.succeed({ id: standing.value.id, effect: STORE_WRITE_EFFECT.REPEATED });
  }
  const read = yield* admitted(context, {
    id: clientId,
    role: MESSAGE_ROLE.USER,
    metadata: line.metadata ?? TYPED_LINE_METADATA,
    parts: lineParts(line.text, line.attachments ?? [], line.mentioned),
  });
  if (Result.isFailure(read)) return Result.fail(read.failure);
  const { id, txid } = yield* insertMessage(context, {
    clientId: read.success.id,
    turnId: undefined,
    message: read.success,
    finishedAt: context.now,
    sender: line.sender,
  });
  const claim = yield* takeDispatchClaim(context.target.conversationId, place, id);
  return Result.succeed({ id, txid, claim });
});

/**
 * Stamps the line its runtime never took withdrawn, unless a turn took it
 * all the same, answering whether it was. Note that the row is kept rather
 * than deleted, because a runtime that took the line past the hand-over's
 * deadline, or before a record that failed, still hands it to a turn, which
 * takes this row with what carried it and who sent it (`takeAwaitingLine`);
 * the maintenance sweep deletes it once no turn can (`abandoned-turns.ts`'s
 * `purgeWithdrawnLines`).
 */
const withdrawUntakenLine = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, id: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, id, now }) =>
    Database.use((db) =>
      db
        .update(messages)
        .set({ withdrawnAt: now })
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.id, id),
            isNull(messages.turnId),
          ),
        )
        .returning({ id: messages.id }),
    ),
});

/**
 * Deletes the withdrawn line under a send's key, which a retry of that send
 * writes afresh at the end of the conversation, as the send it now is,
 * rather than handing over a row standing among lines sent since.
 */
const deleteWithdrawnLine = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, clientId: Schema.String }),
  execute: ({ conversationId, clientId }) =>
    Database.use((db) =>
      db
        .delete(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.clientId, clientId),
            isNull(messages.turnId),
            isNotNull(messages.withdrawnAt),
          ),
        ),
    ),
});

/**
 * Counts the conversation's journal revision up and stamps it as the one a
 * reader holding an older cursor reads the transcript afresh from, as a
 * rewind does, since a row it may already have drawn now reads nowhere.
 */
const markLineWithdrawn = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({
          journalRevision: sql`${conversations.journalRevision} + 1`,
          rewoundRevision: sql`${conversations.journalRevision} + 1`,
        })
        .where(eq(conversations.id, conversationId)),
    ),
});

/**
 * What the hand-over answered, written in a short transaction of its own
 * after it: the claim released, and a line the runtime did not take
 * withdrawn, tried again while the claim stands (`recordedWithinExpiry`).
 * Note that the claim goes first, because its update takes the
 * conversation's row lock, which every writer takes before a message's.
 */
function recordedLine(
  target: ConversationTarget,
  claimed: { readonly id: string; readonly claim: string },
  taken: boolean,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    recordedWithinExpiry(
      client.withTransaction(
        Effect.gen(function* () {
          yield* releaseDispatchClaim(target.conversationId, claimed.claim);
          if (taken) return;
          const removed = yield* withdrawUntakenLine({
            conversationId: target.conversationId,
            id: claimed.id,
            now: yield* DateTime.nowAsDate,
          });
          if (removed.length > 0)
            yield* markLineWithdrawn({ conversationId: target.conversationId });
        }),
      ),
    ),
  );
}

const takeAwaitingLine = /* @__PURE__ */ Effect.fnUntraced(function* (
  context: WriterContext,
  take: AwaitingLineTake,
): Effect.fn.Return<AwaitingLineTaken, StoreFailure, DatabaseServices> {
  if (Option.isNone(yield* turnRow(context, take.turnId))) return Result.fail(NO_TURN);
  const awaiting = yield* findAwaitingLines({ conversationId: context.target.conversationId });
  const runAmong = (lines: typeof awaiting) =>
    "clientId" in take
      ? lines.filter((line) => line.clientId === take.clientId)
      : coalescedRun(lines, take.text);
  // Note that a line whose hand-over answered nothing is taken only where it lengthens the run,
  // because eve heard one only where its answer was lost, and one it never heard standing among the
  // lines it took would part a run eve did coalesce; the lines it took win where the two runs tie.
  const standing = runAmong(awaiting.filter((line) => !line.withdrawn));
  const widened = runAmong(awaiting);
  const run = widened.length > standing.length ? widened : standing;
  const takenAfterStep = run.length === 0 ? null : yield* stepsBegun(context, take.turnId);
  for (const line of run) {
    yield* giveLineToTurn({
      id: line.id,
      conversationId: context.target.conversationId,
      turnId: take.turnId,
      takenAfterStep,
    });
  }
  return Result.succeed(run.map((line) => line.id));
});

const stampTurnCancel = SqlSchema.findAll({
  Request: Schema.Struct({
    turnId: Schema.String,
    conversationId: Schema.String,
    at: Schema.Date,
    key: Schema.NullOr(Schema.String),
    by: Schema.NullOr(Schema.String),
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          cancelRequestedAt: row.at,
          cancelRequestKey: row.key,
          cancelRequestedBy: row.by,
        })
        .where(
          and(
            eq(turns.id, row.turnId),
            eq(turns.conversationId, row.conversationId),
            isNull(turns.cancelRequestedAt),
          ),
        )
        .returning({ id: turns.id }),
    ),
});

/**
 * The Stop on a turn's row: the instant it was asked, the key of the
 * tool call that asked it where one did, and the agent that asked it where
 * one did, written once, so the record says a
 * Stop was asked whatever eve does with it. A second Stop finds the first
 * instant standing and writes nothing, its key included; a turn the
 * conversation does not hold is refused.
 */
const requestTurnCancel = /* @__PURE__ */ Effect.fn("web/requestTurnCancel")(function* (
  context: WriterContext,
  cancel: TurnCancelRequest,
): Effect.fn.Return<TurnCancelResult, StoreFailure, DatabaseServices> {
  if (Option.isNone(yield* turnRow(context, cancel.turnId))) return Result.fail(NO_TURN);
  const stamped = yield* stampTurnCancel({
    turnId: cancel.turnId,
    conversationId: context.target.conversationId,
    at: cancel.at,
    key: cancel.key ?? null,
    by: cancel.by ?? null,
  });
  return Result.succeed(
    stamped.length === 0 ? STORE_WRITE_EFFECT.REPEATED : STORE_WRITE_EFFECT.WRITTEN,
  );
});

/**
 * The notices a write's settled coding agent turns leave for its member's
 * operator (`operator-notices.ts`), written once the write's transaction is
 * done, so the settle neither waits on them under its lock nor fails with
 * them. Each runs in a transaction of its own, a savepoint where the write
 * itself ran inside a caller's, so one that fails is rolled back alone and
 * only logged: a notice never fails or holds the path it rides on.
 */
function noticesAfterSettle(
  client: SqlClient.SqlClient,
  target: ConversationTarget,
  notices: WriterContext["notices"],
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.forEach(
    notices,
    ({ kind, at }) =>
      client
        .withTransaction(writeOperatorNotice({ conversationId: target.conversationId }, kind, at))
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("an operator's notice of a settled turn was not written", {
              kind,
              failure: causeKind(cause),
            }),
          ),
        ),
    { discard: true },
  );
}

/**
 * The settled coding agent turns a write leaves, told the runtime's listener
 * once the write's transaction is done, so the settle never waits on what
 * hears of it; a runtime with no listener tells no one.
 */
function settledAfterCommit(
  settled: readonly SettledAgentTurn[],
): Effect.Effect<void, never, DatabaseServices> {
  if (settled.length === 0) return Effect.void;
  return Effect.flatMap(Effect.serviceOption(SettledTurnListener), (listener) =>
    Option.isNone(listener)
      ? Effect.void
      : Effect.forEach(settled, listener.value.heard, { discard: true }),
  );
}

/**
 * Composes the writer over one catalog, which is where the catalog is held to
 * the unknown outcome's envelope: a tool whose declared output schema refuses
 * it would leave a dispatched call's row unreadable, so the writer refuses to
 * exist over such a catalog rather than writing one.
 */
export function storeWriter({ tools }: StoreWriterOptions): Effect.Effect<StoreWriter> {
  /** The context one write runs in, its instant read from the clock as the conversation is read. */
  function contextOf(
    target: ConversationTarget,
    kind: WriterContext["kind"],
    after: AfterCommit,
  ): Effect.Effect<WriterContext> {
    return Effect.map(DateTime.nowAsDate, (now) => ({
      tools,
      now,
      target,
      kind,
      journals: new Map(),
      ...after,
    }));
  }

  /**
   * Runs one write under the conversation's row lock, or answers that no such
   * conversation stands for this account: none by that id, or one Clear
   * already stamped, which is read by nothing and so written by nothing. The
   * write's instant is read from the clock once the lock is held, so every
   * row one write stamps carries the same one.
   *
   * Note that no write here waits on a hand-over to the runtime under way: a
   * hand-over holds no lock while the runtime answers, only its dispatch
   * claim (`dispatch-claim.ts`), and the line it hands stands before it is
   * handed, so the turn the runtime opens on it finds it.
   */
  function locked<A, E = never>(
    target: ConversationTarget,
    write: (context: WriterContext) => Effect.Effect<A, StoreFailure | E, DatabaseServices>,
    absent: () => A,
  ): Effect.Effect<A, StoreFailure | E, DatabaseServices> {
    return Effect.flatMap(SqlClient.SqlClient, (client) => {
      const after: AfterCommit = { notices: [], settled: [] };
      return client
        .withTransaction(
          Effect.gen(function* () {
            const row = yield* lockConversation(target);
            return yield* lockedWrite(target, row, after, write, absent);
          }),
        )
        .pipe(
          Effect.tap(() => noticesAfterSettle(client, target, after.notices)),
          Effect.tap(() => settledAfterCommit(after.settled)),
        );
    });
  }

  /**
   * Writes the line's row and takes the conversation's dispatch claim in one
   * short transaction, hands the line over with no transaction open, and
   * writes what the runtime answered in a second: the claim released, and a
   * line it did not take withdrawn. The claim is what keeps one hand-over at
   * a time in the conversation, so sends reach the runtime in the order their
   * rows are numbered and two sends under one key hand it the words once; a
   * send finding another's claim waits for it, holding nothing, and is
   * refused as busy past the wait. A hand-over that dies releases the claim
   * and leaves the line standing, as a lost answer leaves it, and a holder
   * that dies with it leaves the claim to expire. Note that a
   * conversation Clear stamped while the runtime answered keeps the row it
   * already had, and the send is answered as written, as the runtime took it.
   */
  function dispatchedLine(
    target: ConversationTarget,
    line: AwaitingLineWrite,
    dispatch: Effect.Effect<boolean>,
  ): Write<AwaitingLineWritten> {
    return Effect.gen(function* () {
      const claimed = yield* waitingOutDispatchClaim(target.conversationId, (place) =>
        locked<LineClaimed, DispatchClaimHeld>(
          target,
          (context) => claimLine(context, line, place),
          () => Result.fail(NO_CONVERSATION),
        ),
      ).pipe(
        Effect.catchTag("DispatchClaimHeld", () =>
          Effect.succeed<LineClaimed>(Result.fail(CONVERSATION_BUSY)),
        ),
      );
      if (Result.isFailure(claimed)) return Result.fail(claimed.failure);
      const written = claimed.success;
      if (!("claim" in written)) return Result.succeed(Option.some(written));
      // A hand-over that died says nothing of whether the runtime took the line, which is kept standing.
      const taken = yield* dispatchedWithinDeadline(dispatch, target.conversationId).pipe(
        Effect.tapCause(() =>
          Effect.ignore(releaseDispatchClaim(target.conversationId, written.claim)),
        ),
      );
      yield* recordedLine(target, written, taken);
      if (!taken) return Result.succeed(Option.none());
      return Result.succeed(
        Option.some({ id: written.id, effect: STORE_WRITE_EFFECT.WRITTEN, txid: written.txid }),
      );
    });
  }

  /** The write itself, once the conversation's row is locked or found absent: its instant read once, its journals landed after it. */
  function lockedWrite<A, E>(
    target: ConversationTarget,
    row: Option.Option<{ readonly kind: WriterContext["kind"] }>,
    after: AfterCommit,
    write: (context: WriterContext) => Effect.Effect<A, StoreFailure | E, DatabaseServices>,
    absent: () => A,
  ): Effect.Effect<A, StoreFailure | E, DatabaseServices> {
    return Effect.gen(function* () {
      if (Option.isNone(row)) return absent();
      const context = yield* contextOf(target, row.value.kind, after);
      const written = yield* write(context);
      yield* landJournals(context);
      return written;
    });
  }

  function underConversation<A, E>(
    target: ConversationTarget,
    write: (context: WriterContext) => Write<Result.Result<A, E>>,
  ): Write<Result.Result<A, E | typeof NO_CONVERSATION>> {
    return locked<Result.Result<A, E | typeof NO_CONVERSATION>>(target, write, () =>
      Result.fail(NO_CONVERSATION),
    );
  }

  const writer: StoreWriter = {
    consume: (target, event) =>
      locked<StoreWriteResult>(
        target,
        (context) => consume(context, event),
        () => Result.fail(NO_CONVERSATION),
      ),
    consumeAll: (target, events) =>
      locked<readonly StoreWriteResult[]>(
        target,
        (context) => Effect.forEach(events, (event) => consume(context, event)),
        () => events.map(() => Result.fail(NO_CONVERSATION)),
      ),
    enqueueTurn: (target, enqueue) =>
      underConversation(target, (context) => enqueueTurn(context, enqueue)),
    requestTurnCancel: (target, cancel) =>
      underConversation(target, (context) => requestTurnCancel(context, cancel)),
    writeAwaitingLine: (target, line, dispatch) =>
      Effect.uninterruptible(dispatchedLine(target, line, dispatch)),
    takeAwaitingLine: (target, take) =>
      underConversation(target, (context) => takeAwaitingLine(context, take)),
  };

  return Effect.flatMap(toolsRefusingUnknownOutcome(tools), (refusing) =>
    refusing.length === 0
      ? Effect.succeed(writer)
      : Effect.die(
          new Error(
            `the output schema of ${refusing.join(", ")} does not admit the unknown outcome's envelope`,
          ),
        ),
  );
}
