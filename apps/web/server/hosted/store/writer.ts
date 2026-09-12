import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import {
  asSchema,
  type ReasoningUIPart,
  type ToolSet,
  type ToolUIPart,
  type UIMessage,
  type UITools,
} from "ai";
import { Effect, Option, type ParseResult, Schema } from "effect";
import {
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  type BrainRunEvent,
  type BrainTurnOrigin,
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  compactionSummaryMessage,
  isSettledToolPartState,
  isStoredToolPart,
  isWireString,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  readStoredUIMessages,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRefusal,
  type SpeechEventKind,
  STEP_START_PART,
  type StoredMessageMetadata,
  type StoredToolPart,
  type StoredUIMessage,
  settledToolPart,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnOrigin,
  type TurnStatus,
  toolPartType,
  UI_PART_STATE,
  UI_PART_TYPE,
  type UnparsedWireValue,
  type UserMessageMetadata,
  unknownActionOutput,
  unparsedWire,
  WireValueSchema,
} from "../../core.js";
import { EpochMillisColumnSchema, nullable } from "./database.js";

/**
 * The store writer: the one path by which a `messages`, `turns`, or `events`
 * row is written. It consumes the brain's run event stream (`BrainRunEvent`,
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
 * Every statement is an `Effect` over the ambient `SqlClient`, the
 * transaction is that client's own, and each row a statement answers is
 * decoded by a `Schema` rather than trusted; the `StoreWriter` methods are
 * effects too, so the edge that owns the connection is the one that runs
 * them and a caller composes a write into the request it is already on.
 */

/** The one output any tool's schema must admit: the envelope of a call whose effect is unknown. */
const UNKNOWN_OUTCOME_PROBE = unknownActionOutput(
  "the call was dispatched and its effect is unknown",
);

/** The tools whose declared output schema would refuse the unknown outcome's envelope. */
const toolsRefusingUnknownOutcome = (tools: ToolSet): Effect.Effect<readonly string[]> =>
  Effect.promise(async () => {
    const refusing: string[] = [];
    for (const [name, declared] of Object.entries(tools)) {
      if (declared.outputSchema === undefined) continue;
      const validate = asSchema(declared.outputSchema).validate;
      if (validate === undefined) continue;
      const result = await validate(UNKNOWN_OUTCOME_PROBE);
      if (!result.success) refusing.push(name);
    }
    return refusing;
  });

export interface ConversationTarget {
  readonly userId: string;
  readonly conversationId: string;
}

interface StoreWriterOptions {
  /** The catalog's `tool()` declarations by name: what a stored tool part may name, and what its input is held to. */
  readonly tools: ToolSet;
  readonly now?: () => Date;
}

/** What one write did: landed, found its row already standing, or had nothing to do for this kind. */
export const STORE_WRITE_EFFECT = {
  WRITTEN: "written",
  REPEATED: "repeated",
  IGNORED: "ignored",
} as const;

type StoreWriteEffect = (typeof STORE_WRITE_EFFECT)[keyof typeof STORE_WRITE_EFFECT];

/**
 * Why a write was refused: the row it needs is not there, the row or call it
 * would change is closed, the claim it makes is already another's, an event
 * it named as excluding it already stands, or what it carries is outside the
 * vocabulary.
 */
export const STORE_WRITE_REFUSAL = {
  NO_CONVERSATION: "no_conversation",
  NO_TURN: "no_turn",
  NO_CALL: "no_call",
  NO_MESSAGE: "no_message",
  FINISHED: "finished",
  ALREADY_CLAIMED: "already_claimed",
  SUPERSEDED: "superseded",
  MESSAGE_REFUSED: "message_refused",
} as const;

type StoreWriteRefusal = (typeof STORE_WRITE_REFUSAL)[keyof typeof STORE_WRITE_REFUSAL];

type Refused<Refusal extends StoreWriteRefusal> = { readonly ok: false; readonly refusal: Refusal };

const NO_CONVERSATION: Refused<typeof STORE_WRITE_REFUSAL.NO_CONVERSATION> = {
  ok: false,
  refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION,
};

const NO_TURN: Refused<typeof STORE_WRITE_REFUSAL.NO_TURN> = {
  ok: false,
  refusal: STORE_WRITE_REFUSAL.NO_TURN,
};

export type StoreWriteResult =
  | { readonly ok: true; readonly effect: StoreWriteEffect }
  | Refused<
      | typeof STORE_WRITE_REFUSAL.NO_CONVERSATION
      | typeof STORE_WRITE_REFUSAL.NO_TURN
      | typeof STORE_WRITE_REFUSAL.NO_CALL
      | typeof STORE_WRITE_REFUSAL.FINISHED
    >
  | {
      readonly ok: false;
      readonly refusal: typeof STORE_WRITE_REFUSAL.MESSAGE_REFUSED;
      readonly reason: SchemaRefusal;
      readonly path: SchemaPath;
    };

type BrainRequestStatus = (typeof BRAIN_REQUEST_STATUS)[keyof typeof BRAIN_REQUEST_STATUS];

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
}

type TurnCancelResult =
  | { readonly ok: true; readonly effect: StoreWriteEffect }
  | typeof NO_CONVERSATION
  | typeof NO_TURN;

type TurnEnqueueResult =
  | { readonly ok: true; readonly turnId: string; readonly effect: StoreWriteEffect }
  | typeof NO_CONVERSATION;

/**
 * What one completed compaction folded, as its owner reports it: the summary
 * the model wrote, the first stored message the model still reads after it,
 * and the input tokens the folded messages had cost where the owner counted
 * them; absent otherwise, never zero.
 */
interface CompactionWrite {
  /** The owner's own id for the fold, the row's idempotency key. */
  readonly clientId: string;
  readonly turnId?: string;
  readonly text: string;
  readonly firstKeptMessageId: string;
  readonly tokensBefore?: number;
}

/**
 * A user message written outside the run stream: the developer's own words
 * as another writer cut them — a spoken ask from a voice session's transcript
 * — with the metadata that says how they arrived. Idempotent on its client id.
 */
interface UserMessageWrite {
  readonly clientId: string;
  readonly turnId?: string;
  /**
   * The row's turn is the ask's that shares its client id, read under the same
   * lock the row is written under: a spoken ask's transcript row and the ask
   * the service submitted for it carry one id, the delegation's, so the row
   * lands attached to the turn the ask already learned, placed ahead of the
   * turn's own rows, and a turn the ask learns later takes the row at its
   * received message.
   */
  readonly turnOfAsk?: true;
  readonly text: string;
  readonly metadata: UserMessageMetadata;
}

/** What the relay's attach did for one turn: the user rows it took into the turn, by id; or the conversation no longer stands. */
type AskLinesAttached =
  | { readonly ok: true; readonly attached: readonly string[] }
  | typeof NO_CONVERSATION;

/** Where the developer's earlier spoken asks on one voice session end, for the next to be cut from. */
interface SpokenAskEnd {
  readonly voiceSessionId: string;
  /** The ask being cut, left out so a delegation told twice cuts the same span. */
  readonly delegationId: string;
}

type SpokenAskEndResult = { readonly ok: true; readonly toMs: number } | typeof NO_CONVERSATION;

type UserMessageWriteResult =
  | { readonly ok: true; readonly id: string; readonly effect: StoreWriteEffect }
  | typeof NO_CONVERSATION
  | Extract<StoreWriteResult, { ok: false; refusal: typeof STORE_WRITE_REFUSAL.MESSAGE_REFUSED }>;

/** An event any caller may write: every kind but speech, whose writes have one door, `store/speech.ts`. */
interface EventWrite {
  readonly messageId: string;
  readonly kind: Exclude<ConversationEventKind, SpeechEventKind>;
  readonly deviceId?: string;
  readonly payload?: UnparsedWireValue;
}

/**
 * A speech event, which cannot be written without naming the kinds whose
 * standing on the message refuse it: read under the conversation's lock in
 * the same transaction as the insert, so a transition decided against the
 * events a caller read lands only while those are still all there are. The
 * speech module composes these; a `speech.*` kind on a plain event write
 * does not compile, which is what keeps every speech transition behind that
 * one door.
 */
interface SpeechEventWrite {
  readonly messageId: string;
  readonly kind: SpeechEventKind;
  readonly deviceId?: string;
  readonly payload?: UnparsedWireValue;
  readonly unless: readonly ConversationEventKind[];
}

type EventWriteResult =
  | { readonly ok: true; readonly id: string; readonly seq: number }
  | Refused<
      | typeof STORE_WRITE_REFUSAL.NO_CONVERSATION
      | typeof STORE_WRITE_REFUSAL.NO_MESSAGE
      | typeof STORE_WRITE_REFUSAL.ALREADY_CLAIMED
      | typeof STORE_WRITE_REFUSAL.SUPERSEDED
    >;

/**
 * The one path by which a conversation's rows are written, each method an
 * effect over the ambient client: a caller composes one into the request it
 * is already running rather than awaiting it out of band.
 */
export interface StoreWriter {
  /** Consumes one event of the run stream for the conversation it names. */
  consume(target: ConversationTarget, event: BrainRunEvent): Write<StoreWriteResult>;
  /** Writes a turn as queued, ahead of the stream telling its start; answers the turn's id. */
  enqueueTurn(target: ConversationTarget, enqueue: TurnEnqueue): Write<TurnEnqueueResult>;
  /** Removes a queued turn the opener has handed to eve; a row eve has started, or one a message names, is left standing. */
  dequeueTurn(target: ConversationTarget, turnId: string): Write<StoreWriteResult>;
  /** Stamps the instant a Stop was asked on a turn the conversation holds, once. */
  requestTurnCancel(target: ConversationTarget, cancel: TurnCancelRequest): Write<TurnCancelResult>;
  /** Writes the assistant message a compaction stands as; the stream's own compaction event carries too little to write it. */
  recordCompaction(
    target: ConversationTarget,
    compaction: CompactionWrite,
  ): Write<StoreWriteResult>;
  /** Appends one event about a message, numbered by the conversation's event sequence. */
  recordEvent(
    target: ConversationTarget,
    event: EventWrite | SpeechEventWrite,
  ): Write<EventWriteResult>;
  /** Writes the developer's own words as a finished user message, once per client id. */
  recordUserMessage(
    target: ConversationTarget,
    message: UserMessageWrite,
  ): Write<UserMessageWriteResult>;
  /**
   * Takes into the turn every user row whose client id is an ask's the turn
   * ran, where the row stands with no turn yet: the other half of
   * `turnOfAsk`, for a row written before the ask learned its turn. A row
   * taken moves to a fresh place in the conversation's sequence, ahead of
   * everything the turn will write, so a device that already passed its old
   * place reads it again where it now stands. Under the conversation's lock,
   * so a row being written meanwhile is seen once it lands, never missed.
   */
  attachAskLines(target: ConversationTarget, turnId: string): Write<AskLinesAttached>;
  /** The latest end, on the session's clock, of the spoken asks already written for one voice session; zero for none. */
  spokenAskEnd(target: ConversationTarget, end: SpokenAskEnd): Write<SpokenAskEndResult>;
}

/**
 * The plan's turn origin for each origin the brain's stream names. The one
 * fold is observation: the hosted tier opens observation turns from roster
 * diffs alone, having no provider hooks, so the brain's `observation` and the
 * plan's `roster_diff` are one event under two names. Every other origin is
 * written as reported.
 */
const TURN_ORIGIN_OF_BRAIN_ORIGIN = {
  [BRAIN_TURN_ORIGIN.TYPED]: TURN_ORIGIN.TYPED,
  [BRAIN_TURN_ORIGIN.SPOKEN]: TURN_ORIGIN.SPOKEN,
  [BRAIN_TURN_ORIGIN.OBSERVATION]: TURN_ORIGIN.ROSTER_DIFF,
  [BRAIN_TURN_ORIGIN.HOLD_RELEASE]: TURN_ORIGIN.HOLD_RELEASE,
  [BRAIN_TURN_ORIGIN.CHILD]: TURN_ORIGIN.CHILD,
  [BRAIN_TURN_ORIGIN.CHILD_COMPLETION]: TURN_ORIGIN.CHILD_COMPLETION,
} as const satisfies Record<BrainTurnOrigin, TurnOrigin>;

function turnStatusOf(status: BrainRequestStatus): TurnStatus {
  switch (status) {
    case BRAIN_REQUEST_STATUS.SUCCEEDED:
      return TURN_STATUS.SETTLED;
    case BRAIN_REQUEST_STATUS.CANCELLED:
      return TURN_STATUS.CANCELLED;
    case BRAIN_REQUEST_STATUS.FAILED:
    case BRAIN_REQUEST_STATUS.TIMED_OUT:
    case BRAIN_REQUEST_STATUS.INTERRUPTED:
    case BRAIN_REQUEST_STATUS.QUEUED:
    case BRAIN_REQUEST_STATUS.RUNNING:
      return TURN_STATUS.FAILED;
  }
}

const TERMINAL_TURN_STATUSES: ReadonlySet<TurnStatus> = new Set([
  TURN_STATUS.SETTLED,
  TURN_STATUS.CANCELLED,
  TURN_STATUS.FAILED,
]);

type ToolPart = ToolUIPart<UITools>;

type Parts = StoredUIMessage["parts"];

const BRAIN_AUTHORED = { author: MESSAGE_AUTHOR.BRAIN } as const;

/** How a statement here fails: the driver's own refusal, or a row the schema refused. */
type WriteFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

/**
 * A row a statement had to answer. Its absence is this writer's own
 * invariant broken — a conversation that vanished under its own lock, an
 * insert that returned nothing — which is a defect rather than an outcome a
 * caller could act on, so it dies with the same words it threw before.
 */
function required<A>(row: Option.Option<A>, absent: string): Effect.Effect<A> {
  return Option.match(row, { onNone: () => Effect.dieMessage(absent), onSome: Effect.succeed });
}

const readsJsonObject = Schema.is(Schema.Record({ key: Schema.String, value: Schema.Unknown }));

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
 * A write and a read take the same value through different sides: the column
 * takes the row's JSON text, cast to `jsonb` in the statement, so a write
 * names `Schema.parseJson` over these and a read names them directly,
 * because a `jsonb` column answers a parsed value.
 */
const StoredPartsColumnSchema: Schema.Schema<Parts> = Schema.declare((input): input is Parts =>
  readsPartsShape(input),
);

const MessageMetadataColumnSchema: Schema.Schema<StoredMessageMetadata> = Schema.declare(
  (input): input is StoredMessageMetadata => readsJsonObject(input),
);

/** What a turn's run cost, as the four counts the trace keeps; the brain's own shape, written here and read by the store's reads. */
const TurnUsageColumnSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  reasoningTokens: Schema.Number,
});

export const ConversationEventKindSchema = Schema.Literal(
  ...Object.values(CONVERSATION_EVENT_KIND),
);

const MessageRoleSchema = Schema.Literal(...Object.values(MESSAGE_ROLE));

const TurnStatusSchema = Schema.Literal(...Object.values(TURN_STATUS));

const TurnOriginSchema = Schema.Literal(...Object.values(TURN_ORIGIN));

const RowIdSchema = Schema.Struct({ id: Schema.String });

const ConversationTargetSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
});

/**
 * The counter's value after an allocation moved it, which is one past the
 * position handed out. It is a 64-bit column like every instant here, so it
 * is read through the same schema they are: `pg` hands an `int8` back as a
 * string and PGlite as a number, and a sequence position is as far inside the
 * safe integer range as a millisecond is.
 */
const SequenceSchema = Schema.Struct({ next: EpochMillisColumnSchema });

/** The message row this writer reads back to decide its next write: what stands, and whether it is closed. */
const MessageRowSchema = Schema.Struct({
  id: Schema.String,
  parts: StoredPartsColumnSchema,
  metadata: Schema.NullOr(MessageMetadataColumnSchema),
  finishedAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("finished_at"),
  ),
});

type MessageRow = Schema.Schema.Type<typeof MessageRowSchema>;

const TurnRowSchema = Schema.Struct({ status: TurnStatusSchema });

const MessageInsertSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  seq: Schema.Int,
  turnId: Schema.NullOr(Schema.String),
  clientId: Schema.String,
  role: MessageRoleSchema,
  parts: Schema.parseJson(StoredPartsColumnSchema),
  metadata: Schema.NullOr(Schema.parseJson(MessageMetadataColumnSchema)),
  createdAt: Schema.DateFromSelf,
  finishedAt: Schema.NullOr(Schema.DateFromSelf),
});

const lockConversation = SqlSchema.findOne({
  Request: ConversationTargetSchema,
  Result: RowIdSchema,
  execute: (target) =>
    statement(
      (sql) => sql`
        select id
        from conversations
        where id = ${target.conversationId}
          and user_id = ${target.userId}
          and deleted_at is null
        for update
      `,
    ),
});

const allocateMessageSequence = SqlSchema.findOne({
  Request: Schema.Struct({ conversationId: Schema.String, now: Schema.DateFromSelf }),
  Result: SequenceSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        update conversations
        set next_message_seq = greatest(
              next_message_seq,
              (select coalesce(max(seq), 0) + 1 from messages where conversation_id = ${request.conversationId})
            ) + 1,
            last_activity_at = ${request.now}
        where id = ${request.conversationId}
        returning next_message_seq as next
      `,
    ),
});

const allocateEventSequence = SqlSchema.findOne({
  Request: Schema.String,
  Result: SequenceSchema,
  execute: (conversationId) =>
    statement(
      (sql) => sql`
        update conversations
        set next_event_seq = greatest(
              next_event_seq,
              (select coalesce(max(seq), 0) + 1 from events where conversation_id = ${conversationId})
            ) + 1
        where id = ${conversationId}
        returning next_event_seq as next
      `,
    ),
});

const findTurn = SqlSchema.findOne({
  Request: Schema.Struct({ turnId: Schema.String, conversationId: Schema.String }),
  Result: TurnRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select status
        from turns
        where id = ${request.turnId} and conversation_id = ${request.conversationId}
      `,
    ),
});

const findMessageByClientId = SqlSchema.findOne({
  Request: Schema.Struct({ conversationId: Schema.String, clientId: Schema.String }),
  Result: MessageRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select id, parts, metadata, finished_at
        from messages
        where conversation_id = ${request.conversationId} and client_id = ${request.clientId}
      `,
    ),
});

const insertMessageRow = SqlSchema.findOne({
  Request: MessageInsertSchema,
  Result: RowIdSchema,
  execute: (row) =>
    statement(
      (sql) => sql`
        insert into messages (
          user_id, conversation_id, seq, turn_id, client_id, role, parts, metadata, created_at, finished_at
        )
        values (
          ${row.userId}, ${row.conversationId}, ${row.seq}, ${row.turnId}, ${row.clientId},
          ${row.role}, ${row.parts}::jsonb, ${row.metadata}::jsonb, ${row.createdAt}, ${row.finishedAt}
        )
        returning id
      `,
    ),
});

const updateMessageParts = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    parts: Schema.parseJson(StoredPartsColumnSchema),
  }),
  execute: (row) =>
    statement(
      (sql) => sql`
        update messages set parts = ${row.parts}::jsonb where id = ${row.id}
      `,
    ),
});

const finishMessage = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    parts: Schema.parseJson(StoredPartsColumnSchema),
    finishedAt: Schema.DateFromSelf,
  }),
  execute: (row) =>
    statement(
      (sql) => sql`
        update messages
        set parts = ${row.parts}::jsonb, finished_at = ${row.finishedAt}
        where id = ${row.id}
      `,
    ),
});

const completeMessage = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    parts: Schema.parseJson(StoredPartsColumnSchema),
    metadata: Schema.NullOr(Schema.parseJson(MessageMetadataColumnSchema)),
    finishedAt: Schema.DateFromSelf,
  }),
  execute: (row) =>
    statement(
      (sql) => sql`
        update messages
        set parts = ${row.parts}::jsonb,
            metadata = ${row.metadata}::jsonb,
            finished_at = ${row.finishedAt}
        where id = ${row.id}
      `,
    ),
});

const insertStartedTurn = SqlSchema.void({
  Request: Schema.Struct({
    turnId: Schema.String,
    userId: Schema.String,
    conversationId: Schema.String,
    origin: TurnOriginSchema,
    startedAt: Schema.DateFromSelf,
  }),
  execute: (row) =>
    statement(
      (sql) => sql`
        insert into turns (id, user_id, conversation_id, origin, status, queued_at, started_at)
        values (
          ${row.turnId}, ${row.userId}, ${row.conversationId}, ${row.origin},
          ${TURN_STATUS.RUNNING}, ${row.startedAt}, ${row.startedAt}
        )
      `,
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
    queuedAt: Schema.DateFromSelf,
  }),
  execute: (row) =>
    statement(
      (sql) => sql`
        insert into turns (
          id, user_id, conversation_id, origin, status, eve_turn_id, model, reasoning_effort,
          prompt_hash, tool_set_hash, queued_at
        )
        values (
          ${row.turnId}, ${row.userId}, ${row.conversationId}, ${row.origin}, ${TURN_STATUS.QUEUED},
          ${row.eveTurnId}, ${row.model}, ${row.reasoningEffort}, ${row.promptHash}, ${row.toolSetHash},
          ${row.queuedAt}
        )
      `,
    ),
});

const startTurn = SqlSchema.void({
  Request: Schema.Struct({ turnId: Schema.String, startedAt: Schema.DateFromSelf }),
  execute: (row) =>
    statement(
      (sql) => sql`
        update turns
        set status = ${TURN_STATUS.RUNNING}, started_at = ${row.startedAt}
        where id = ${row.turnId}
      `,
    ),
});

const settleTurn = SqlSchema.void({
  Request: Schema.Struct({
    turnId: Schema.String,
    status: TurnStatusSchema,
    settledAt: Schema.DateFromSelf,
    failure: Schema.NullOr(Schema.String),
    usage: Schema.NullOr(Schema.parseJson(TurnUsageColumnSchema)),
    responseIds: Schema.Array(Schema.String),
  }),
  execute: (row) =>
    statement(
      (sql) => sql`
        update turns
        set status = ${row.status},
            settled_at = ${row.settledAt},
            failure = ${row.failure},
            usage = ${row.usage}::jsonb,
            response_ids = ${row.responseIds}
        where id = ${row.turnId}
      `,
    ),
});

/**
 * Where the developer's spoken asks on one voice session reach on that
 * session's clock: the metadata's own `to_ms`, read out of the `jsonb`
 * column, over every ask of that session but the one being cut.
 */
const findSpokenAskEnd = SqlSchema.findOne({
  Request: Schema.Struct({
    conversationId: Schema.String,
    delegationId: Schema.String,
    voiceSessionId: Schema.String,
  }),
  Result: Schema.Struct({
    toMs: Schema.propertySignature(Schema.Number).pipe(Schema.fromKey("to_ms")),
  }),
  execute: (request) =>
    statement(
      (sql) => sql`
        select coalesce(max((metadata ->> 'to_ms')::int), 0)::int as to_ms
        from messages
        where conversation_id = ${request.conversationId}
          and client_id <> ${request.delegationId}
          and metadata ->> 'voice_session_id' = ${request.voiceSessionId}
      `,
    ),
});

const findMessageInConversation = SqlSchema.findOne({
  Request: Schema.Struct({ messageId: Schema.String, conversationId: Schema.String }),
  Result: RowIdSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select id
        from messages
        where id = ${request.messageId} and conversation_id = ${request.conversationId}
      `,
    ),
});

const findEventKinds = SqlSchema.findAll({
  Request: Schema.Struct({
    messageId: Schema.String,
    kinds: Schema.Array(ConversationEventKindSchema),
  }),
  Result: Schema.Struct({ kind: ConversationEventKindSchema }),
  execute: (request) =>
    statement(
      (sql) => sql`
        select kind
        from events
        where message_id = ${request.messageId} and kind in ${sql.in(request.kinds)}
      `,
    ),
});

const insertEvent = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    seq: Schema.Int,
    messageId: Schema.String,
    kind: ConversationEventKindSchema,
    deviceId: Schema.NullOr(Schema.String),
    payload: Schema.NullOr(Schema.parseJson(WireValueSchema)),
    createdAt: Schema.DateFromSelf,
  }),
  Result: RowIdSchema,
  execute: (row) =>
    statement(
      (sql) => sql`
        insert into events (user_id, conversation_id, seq, message_id, kind, device_id, payload, created_at)
        values (
          ${row.userId}, ${row.conversationId}, ${row.seq}, ${row.messageId}, ${row.kind},
          ${row.deviceId}, ${row.payload}::jsonb, ${row.createdAt}
        )
        returning id
      `,
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
 * A call the turn left unanswered, settled once the turn is over as the one
 * thing the record can truthfully say of it: the call was dispatched and its
 * effect is unknown, an answer whose envelope says so, never an error, which
 * would read as a refusal and license doing it again.
 */
function unansweredToolPart(part: StoredToolPart, status: BrainRequestStatus): ToolPart {
  return {
    type: part.type,
    toolCallId: part.toolCallId,
    state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
    input: part.input,
    output: unknownActionOutput(
      status === BRAIN_REQUEST_STATUS.CANCELLED
        ? "The turn was cancelled before the call answered; it may have run."
        : "The turn ended before the call answered; it may have run.",
    ),
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

interface WriterContext {
  readonly tools: ToolSet;
  readonly now: () => Date;
  readonly target: ConversationTarget;
}

/** What one of this writer's statements answers: an effect over the transaction it runs in. */
type Write<Result> = Effect.Effect<Result, WriteFailure, SqlClient.SqlClient>;

type Admitted =
  | { readonly ok: true; readonly message: StoredUIMessage }
  | Extract<StoreWriteResult, { ok: false; refusal: typeof STORE_WRITE_REFUSAL.MESSAGE_REFUSED }>;

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
    Effect.promise(() =>
      readStoredUIMessages(unparsedWire([JSON.parse(JSON.stringify(message))]), context.tools),
    ),
    (read): Effect.Effect<Admitted> => {
      if (!read.ok) {
        return Effect.succeed({
          ok: false,
          refusal: STORE_WRITE_REFUSAL.MESSAGE_REFUSED,
          reason: read.refusal,
          path: read.path,
        } as const);
      }
      const [stored] = read.value;
      return stored === undefined
        ? Effect.dieMessage("the reader answered no row for one message")
        : Effect.succeed({ ok: true, message: stored } as const);
    },
  );
}

/**
 * The next position of the conversation's message sequence: the counter's
 * own, or one past the highest position a row already holds where the
 * counter fell behind it, and the counter moved past whichever was handed
 * out. The read of `max(seq)` is served by the unique index over the pair.
 */
function allocateMessageSeq(context: WriterContext): Write<number> {
  return Effect.gen(function* () {
    const row = yield* allocateMessageSequence({
      conversationId: context.target.conversationId,
      now: context.now(),
    });
    const allocated = yield* required(row, "the conversation vanished under its own lock");
    return allocated.next - 1;
  });
}

function allocateEventSeq(context: WriterContext): Write<number> {
  return Effect.gen(function* () {
    const row = yield* allocateEventSequence(context.target.conversationId);
    const allocated = yield* required(row, "the conversation vanished under its own lock");
    return allocated.next - 1;
  });
}

function turnRow(
  context: WriterContext,
  turnId: string,
): Write<Option.Option<{ status: TurnStatus }>> {
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

/** Where a row landed: its id, and the position it took. */
interface InsertedMessage {
  readonly id: string;
  readonly seq: number;
}

function insertMessage(
  context: WriterContext,
  row: {
    clientId: string;
    turnId: string | undefined;
    message: StoredUIMessage;
    finishedAt: Date | undefined;
  },
): Write<InsertedMessage> {
  return Effect.gen(function* () {
    const seq = yield* allocateMessageSeq(context);
    const metadata: StoredMessageMetadata | undefined =
      row.message.role === MESSAGE_ROLE.SYSTEM ? undefined : row.message.metadata;
    const inserted = yield* insertMessageRow({
      userId: context.target.userId,
      conversationId: context.target.conversationId,
      seq,
      turnId: nullable(row.turnId),
      clientId: row.clientId,
      role: row.message.role,
      parts: row.message.parts,
      metadata: nullable(metadata),
      createdAt: context.now(),
      finishedAt: nullable(row.finishedAt),
    });
    const written = yield* required(inserted, "the message insert answered no row");
    return { id: written.id, seq };
  });
}

type Journal =
  | { readonly ok: true; readonly row: MessageRow }
  | Refused<typeof STORE_WRITE_REFUSAL.NO_TURN | typeof STORE_WRITE_REFUSAL.FINISHED>;

/** Whether a turn may still take a new message or part: it stands, and it has not ended. */
function openTurn(
  context: WriterContext,
  turnId: string,
): Write<
  Refused<typeof STORE_WRITE_REFUSAL.NO_TURN | typeof STORE_WRITE_REFUSAL.FINISHED> | undefined
> {
  return Effect.map(turnRow(context, turnId), (turn) => {
    if (Option.isNone(turn)) return { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN } as const;
    if (TERMINAL_TURN_STATUSES.has(turn.value.status)) {
      return { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED } as const;
    }
    return undefined;
  });
}

/**
 * The turn's one assistant message, the journal of the turn under way: keyed
 * by the turn's id as its client id, opened by the first part the turn
 * reports while the turn still runs, and closed by the turn's answer or its
 * end. A turn that has ended opens no journal after the fact.
 */
function journal(context: WriterContext, turnId: string): Write<Journal> {
  return Effect.gen(function* () {
    const standing = yield* messageByClientId(context, turnId);
    if (Option.isSome(standing)) return { ok: true, row: standing.value };
    const closed = yield* openTurn(context, turnId);
    if (closed !== undefined) return closed;
    const { id } = yield* insertMessage(context, {
      clientId: turnId,
      turnId,
      message: { id: turnId, role: MESSAGE_ROLE.ASSISTANT, metadata: BRAIN_AUTHORED, parts: [] },
      finishedAt: undefined,
    });
    return { ok: true, row: { id, parts: [], metadata: BRAIN_AUTHORED, finishedAt: null } };
  });
}

/** Writes the journal's parts as they now stand, held to the vocabulary first. */
function amendJournal(
  context: WriterContext,
  row: MessageRow,
  parts: Parts,
): Write<StoreWriteResult> {
  return Effect.gen(function* () {
    const read = yield* admitted(context, {
      id: row.id,
      role: MESSAGE_ROLE.ASSISTANT,
      metadata: BRAIN_AUTHORED,
      parts,
    });
    if (!read.ok) return read;
    yield* updateMessageParts({ id: row.id, parts: read.message.parts });
    return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
  });
}

function turnStarted(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.TURN_STARTED }>,
): Write<StoreWriteResult> {
  return Effect.gen(function* () {
    const standing = yield* turnRow(context, event.turnId);
    const startedAt = new Date(event.at);
    if (Option.isNone(standing)) {
      yield* insertStartedTurn({
        turnId: event.turnId,
        userId: context.target.userId,
        conversationId: context.target.conversationId,
        origin: TURN_ORIGIN_OF_BRAIN_ORIGIN[event.origin],
        startedAt,
      });
      return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
    }
    if (standing.value.status !== TURN_STATUS.QUEUED) {
      return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
    }
    yield* startTurn({ turnId: event.turnId, startedAt });
    return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
  });
}

function turnEnded(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.TURN_ENDED }>,
): Write<StoreWriteResult> {
  return Effect.gen(function* () {
    const standing = yield* turnRow(context, event.turnId);
    if (Option.isNone(standing)) return { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN };
    if (TERMINAL_TURN_STATUSES.has(standing.value.status)) {
      return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
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
      usage: nullable(event.usage),
      responseIds: event.responseIds,
    });
    const open = yield* messageByClientId(context, event.turnId);
    if (Option.isSome(open) && open.value.finishedAt === null) {
      const parts = open.value.parts.map((part) =>
        isStoredToolPart(part) && !isSettledToolPartState(part.state)
          ? unansweredToolPart(part, event.status)
          : part,
      );
      yield* finishMessage({ id: open.value.id, parts, finishedAt: settledAt });
    }
    return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
  });
}

/**
 * A step joins the journal as the boundary before its parts. Steps are
 * counted, not named, so the journal's own count of boundaries is what tells
 * a step told twice from the next one: a step the journal already holds is a
 * repeat, and any later step appends one boundary, whatever the stream
 * dropped between. The turn's completed projection replaces the journal
 * whole, boundaries and all, when the turn answers.
 */
function stepStarted(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.STEP_STARTED }>,
): Write<StoreWriteResult> {
  return Effect.gen(function* () {
    const opened = yield* journal(context, event.turnId);
    if (!opened.ok) return opened;
    const { row } = opened;
    const held = row.parts.filter((part) => part.type === UI_PART_TYPE.STEP_START).length;
    if (held >= event.step) return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
    if (row.finishedAt !== null) return { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED };
    return yield* amendJournal(context, row, [...row.parts, STEP_START_PART]);
  });
}

function toolCallStarted(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.TOOL_CALL_STARTED }>,
): Write<StoreWriteResult> {
  return Effect.gen(function* () {
    const opened = yield* journal(context, event.turnId);
    if (!opened.ok) return opened;
    const { row } = opened;
    if (toolPartOf(row.parts, event.callId) !== undefined) {
      return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
    }
    if (row.finishedAt !== null) return { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED };
    return yield* amendJournal(context, row, [
      ...row.parts,
      pendingToolPart(event.name, event.callId, event.input),
    ]);
  });
}

function toolCallSettled(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.TOOL_CALL_SETTLED }>,
): Write<StoreWriteResult> {
  return Effect.gen(function* () {
    const standing = yield* messageByClientId(context, event.turnId);
    if (Option.isNone(standing)) {
      const turn = yield* turnRow(context, event.turnId);
      return {
        ok: false,
        refusal: Option.isNone(turn) ? STORE_WRITE_REFUSAL.NO_TURN : STORE_WRITE_REFUSAL.NO_CALL,
      };
    }
    const row = standing.value;
    const found = toolPartOf(row.parts, event.callId);
    if (found === undefined) return { ok: false, refusal: STORE_WRITE_REFUSAL.NO_CALL };
    // A call settles once. The same settlement told again is a repeat; a
    // different one, after the turn's end already settled the call as
    // unanswered, finds the call closed and is refused rather than rewritten.
    if (isSettledToolPartState(found.part.state)) {
      return isDeepStrictEqual(settledToolPart(found.part, event.settlement), found.part)
        ? { ok: true, effect: STORE_WRITE_EFFECT.REPEATED }
        : { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED };
    }
    if (row.finishedAt !== null) return { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED };
    const parts = [...row.parts];
    parts[found.index] = settledToolPart(found.part, event.settlement);
    return yield* amendJournal(context, row, parts);
  });
}

/**
 * A reasoning summary joins the journal under its item's id. An item that
 * names no id is not journaled: nothing could tell its second delivery from
 * a second item, and the turn's completed projection carries every summary
 * under the id the adapter lifted for it.
 */
function reasoningCompleted(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.REASONING_COMPLETED }>,
): Write<StoreWriteResult> {
  return Effect.gen(function* () {
    const { id } = event.item;
    if (!isWireString(id)) return { ok: true, effect: STORE_WRITE_EFFECT.IGNORED };
    const opened = yield* journal(context, event.turnId);
    if (!opened.ok) return opened;
    const { row } = opened;
    if (row.parts.some((part) => part.type === UI_PART_TYPE.REASONING && part.id === id)) {
      return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
    }
    if (row.finishedAt !== null) return { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED };
    return yield* amendJournal(context, row, [...row.parts, reasoningPart(event.summary, id)]);
  });
}

/**
 * A completed message: a user message lands as its own row by its id; the
 * turn's answer closes the turn's journal, its parts replaced whole by the
 * projection the turn told, since the projection is the message as the
 * runtime's own record has it and the journal was the record of it in flight.
 * A closed journal takes the same projection again as a repeat and a
 * different one as the late write it is.
 */
function messageCompleted(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.MESSAGE_COMPLETED }>,
): Write<StoreWriteResult> {
  return Effect.gen(function* () {
    const read = yield* admitted(context, event.message);
    if (!read.ok) return read;
    const { message } = read;
    if (message.role !== MESSAGE_ROLE.ASSISTANT) {
      const standing = yield* messageByClientId(context, message.id);
      if (Option.isSome(standing)) return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
      const closed = yield* openTurn(context, event.turnId);
      if (closed !== undefined) return closed;
      yield* insertMessage(context, {
        clientId: message.id,
        turnId: event.turnId,
        message,
        finishedAt: context.now(),
      });
      return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
    }
    const opened = yield* journal(context, event.turnId);
    if (!opened.ok) return opened;
    const { row } = opened;
    if (row.finishedAt !== null) {
      return isDeepStrictEqual(row.parts, message.parts)
        ? { ok: true, effect: STORE_WRITE_EFFECT.REPEATED }
        : { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED };
    }
    yield* completeMessage({
      id: row.id,
      parts: message.parts,
      metadata: nullable(message.metadata),
      finishedAt: context.now(),
    });
    return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
  });
}

function consume(context: WriterContext, event: BrainRunEvent): Write<StoreWriteResult> {
  switch (event.kind) {
    case BRAIN_RUN_EVENT.TURN_STARTED:
      return turnStarted(context, event);
    case BRAIN_RUN_EVENT.TURN_ENDED:
      return turnEnded(context, event);
    case BRAIN_RUN_EVENT.STEP_STARTED:
      return stepStarted(context, event);
    case BRAIN_RUN_EVENT.TOOL_CALL_STARTED:
      return toolCallStarted(context, event);
    case BRAIN_RUN_EVENT.TOOL_CALL_SETTLED:
      return toolCallSettled(context, event);
    case BRAIN_RUN_EVENT.REASONING_COMPLETED:
      return reasoningCompleted(context, event);
    case BRAIN_RUN_EVENT.MESSAGE_COMPLETED:
      return messageCompleted(context, event);
    // The stream's compaction event names neither the summary's first kept
    // message nor, under eve, the summary's text: the compaction's owner
    // writes the row through `recordCompaction`. The rest of the stream is
    // the relay's, about a run's moments rather than the record.
    case BRAIN_RUN_EVENT.COMPACTION_COMPLETED:
    case BRAIN_RUN_EVENT.SLOW_STEP:
    case BRAIN_RUN_EVENT.ACTIONS_SETTLED:
    case BRAIN_RUN_EVENT.REPLY_SENTENCE:
    case BRAIN_RUN_EVENT.ENDED:
      return Effect.succeed({ ok: true, effect: STORE_WRITE_EFFECT.IGNORED });
  }
}

function enqueueTurn(context: WriterContext, enqueue: TurnEnqueue): Write<TurnEnqueueResult> {
  return Effect.gen(function* () {
    const turnId = enqueue.turnId ?? randomUUID();
    if (Option.isSome(yield* turnRow(context, turnId))) {
      return { ok: true, turnId, effect: STORE_WRITE_EFFECT.REPEATED };
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
      queuedAt: context.now(),
    });
    return { ok: true, turnId, effect: STORE_WRITE_EFFECT.WRITTEN };
  });
}

/**
 * A queued row is the opener's inbox, never the run's record: the turn eve
 * runs for it is recorded by the relay under eve's own identity, with the
 * origin the message named, so once eve has taken the message the queued
 * row has done its work and goes. A row eve has since started is eve's turn
 * and is not the opener's to remove, and a row a message names is a record
 * whatever its status; both are left as they stand.
 */
const findMessageNamingTurn = SqlSchema.findOne({
  Request: Schema.String,
  Result: RowIdSchema,
  execute: (turnId) =>
    statement((sql) => sql`select id from messages where turn_id = ${turnId} limit 1`),
});

const deleteQueuedTurn = SqlSchema.void({
  Request: Schema.Struct({ turnId: Schema.String, conversationId: Schema.String }),
  execute: (request) =>
    statement(
      (sql) => sql`
        delete from turns
        where id = ${request.turnId}
          and conversation_id = ${request.conversationId}
          and status = ${TURN_STATUS.QUEUED}
      `,
    ),
});

const stampTurnCancel = SqlSchema.findAll({
  Request: Schema.Struct({
    turnId: Schema.String,
    conversationId: Schema.String,
    at: Schema.DateFromSelf,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (row) =>
    statement(
      (sql) => sql`
        update turns
        set cancel_requested_at = ${row.at}
        where id = ${row.turnId} and conversation_id = ${row.conversationId}
          and cancel_requested_at is null
        returning id
      `,
    ),
});

function dequeueTurn(context: WriterContext, turnId: string): Write<StoreWriteResult> {
  return Effect.gen(function* () {
    const standing = yield* turnRow(context, turnId);
    if (Option.isNone(standing)) return { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN };
    if (standing.value.status !== TURN_STATUS.QUEUED) {
      return { ok: true, effect: STORE_WRITE_EFFECT.IGNORED };
    }
    if (Option.isSome(yield* findMessageNamingTurn(turnId))) {
      return { ok: true, effect: STORE_WRITE_EFFECT.IGNORED };
    }
    yield* deleteQueuedTurn({ turnId, conversationId: context.target.conversationId });
    return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
  });
}

/**
 * The Stop on a turn's row: the instant it was asked, written once, so the
 * record says a Stop was asked whatever eve does with it. A second Stop finds
 * the first instant standing and writes nothing; a turn the conversation does
 * not hold is refused.
 */
function requestTurnCancel(
  context: WriterContext,
  cancel: TurnCancelRequest,
): Write<TurnCancelResult> {
  return Effect.gen(function* () {
    if (Option.isNone(yield* turnRow(context, cancel.turnId))) return NO_TURN;
    const stamped = yield* stampTurnCancel({
      turnId: cancel.turnId,
      conversationId: context.target.conversationId,
      at: cancel.at,
    });
    return {
      ok: true,
      effect: stamped.length === 0 ? STORE_WRITE_EFFECT.REPEATED : STORE_WRITE_EFFECT.WRITTEN,
    };
  });
}

/** Whether a stored row is a compaction: an assistant row whose metadata names what it folded. */
function isCompactionRow(row: MessageRow): boolean {
  return (
    row.metadata !== null && "compaction" in row.metadata && row.metadata.compaction !== undefined
  );
}

/**
 * The compaction row for one completed fold, built by the session package's
 * own builder so the row is the shape every reader of a compaction expects,
 * and held to the vocabulary like every other message before it lands. An
 * owner's id names one of its own folds: a row of another kind under it is
 * the owner's mistake, not a repeat.
 */
function recordCompaction(
  context: WriterContext,
  compaction: CompactionWrite,
): Write<StoreWriteResult> {
  return Effect.gen(function* () {
    const standing = yield* messageByClientId(context, compaction.clientId);
    if (Option.isSome(standing)) {
      if (!isCompactionRow(standing.value)) {
        return yield* Effect.dieMessage(
          "a compaction's client id names a message that is not a compaction",
        );
      }
      return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
    }
    if (compaction.turnId !== undefined) {
      const turn = yield* turnRow(context, compaction.turnId);
      if (Option.isNone(turn)) return { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN };
    }
    const built = compactionSummaryMessage(compaction.clientId, {
      text: compaction.text,
      firstKeptMessageId: compaction.firstKeptMessageId,
      ...(compaction.tokensBefore !== undefined
        ? { tokensBefore: compaction.tokensBefore }
        : undefined),
    });
    if (built === undefined) {
      return {
        ok: false,
        refusal: STORE_WRITE_REFUSAL.MESSAGE_REFUSED,
        reason: SCHEMA_REFUSAL.MALFORMED,
        path: [],
      };
    }
    const read = yield* admitted(context, built);
    if (!read.ok) return read;
    yield* insertMessage(context, {
      clientId: compaction.clientId,
      turnId: compaction.turnId,
      message: read.message,
      finishedAt: context.now(),
    });
    return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
  });
}

function spokenAskEnd(context: WriterContext, end: SpokenAskEnd): Write<SpokenAskEndResult> {
  return Effect.map(
    findSpokenAskEnd({
      conversationId: context.target.conversationId,
      delegationId: end.delegationId,
      voiceSessionId: end.voiceSessionId,
    }),
    (row) => ({ ok: true, toMs: Option.match(row, { onNone: () => 0, onSome: (it) => it.toMs }) }),
  );
}

function recordUserMessage(
  context: WriterContext,
  write: UserMessageWrite,
): Write<UserMessageWriteResult> {
  return Effect.gen(function* () {
    const standing = yield* messageByClientId(context, write.clientId);
    if (Option.isSome(standing)) {
      return { ok: true, id: standing.value.id, effect: STORE_WRITE_EFFECT.REPEATED };
    }
    const read = yield* admitted(context, {
      id: write.clientId,
      role: MESSAGE_ROLE.USER,
      metadata: write.metadata,
      parts: [{ type: UI_PART_TYPE.TEXT, text: write.text, state: UI_PART_STATE.DONE }],
    });
    if (!read.ok) return read;
    const turnId =
      write.turnId ??
      (write.turnOfAsk
        ? yield* askTurnOf({
            conversationId: context.target.conversationId,
            clientId: write.clientId,
          })
        : undefined);
    const { id, seq } = yield* insertMessage(context, {
      clientId: write.clientId,
      turnId,
      message: read.message,
      finishedAt: context.now(),
    });
    if (write.turnOfAsk && turnId !== undefined) yield* moveTurnWorkAfter(context, turnId, seq);
    return { ok: true, id, effect: STORE_WRITE_EFFECT.WRITTEN };
  });
}

/**
 * The turn an ask of the conversation has learned, by the ask's client id,
 * where the turn's row stands: a first ask learns its turn's id at dispatch,
 * before eve's start writes the row, and a message names only a turn on
 * record, so until then the row lands unattached and the relay takes it at
 * the turn's received message, under this same lock.
 */
function askTurnOf(key: {
  readonly conversationId: string;
  readonly clientId: string;
}): Effect.Effect<string | undefined, SqlError | ParseResult.ParseError, SqlClient.SqlClient> {
  return Effect.map(findAskTurn(key), (found) =>
    Option.match(found, { onNone: () => undefined, onSome: (row) => row.turnId ?? undefined }),
  );
}

const findAskTurn = SqlSchema.findOne({
  Request: Schema.Struct({ conversationId: Schema.String, clientId: Schema.String }),
  Result: Schema.Struct({
    turnId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(Schema.fromKey("turn_id")),
  }),
  execute: (key) =>
    statement(
      (sql) => sql`
        select asks.turn_id
        from asks
        join turns on turns.id = asks.turn_id
        where asks.conversation_id = ${key.conversationId} and asks.client_id = ${key.clientId}
      `,
    ),
});

/** The user rows of the turn's asks still standing outside it, in the order they were written. */
const findUnattachedAskLines = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String }),
  Result: RowIdSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select messages.id
        from messages
        join asks
          on asks.conversation_id = messages.conversation_id
         and asks.client_id = messages.client_id
        where asks.conversation_id = ${key.conversationId}
          and asks.turn_id = ${key.turnId}::uuid
          and messages.turn_id is null
        order by messages.seq asc
      `,
    ),
});

const placeMessageInTurn = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String, turnId: Schema.String, seq: Schema.Int }),
  execute: (row) =>
    statement(
      (sql) => sql`
        update messages set turn_id = ${row.turnId}::uuid, seq = ${row.seq} where id = ${row.id}
      `,
    ),
});

/** The turn's own rows — its journal, its answer, a compaction — standing ahead of a place, in sequence. */
const findTurnWorkBefore = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String, seq: Schema.Int }),
  Result: RowIdSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select id
        from messages
        where conversation_id = ${key.conversationId}
          and turn_id = ${key.turnId}::uuid
          and role <> ${MESSAGE_ROLE.USER}
          and seq < ${key.seq}
        order by seq asc
      `,
    ),
});

const moveMessage = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String, seq: Schema.Int }),
  execute: (row) =>
    statement((sql) => sql`update messages set seq = ${row.seq} where id = ${row.id}`),
});

/**
 * The sequence is the order and the delivery both: a device reads past the
 * last position it took, so a row is in the group a device draws it in
 * only if it stood there when the device passed it. A row that changes
 * turn therefore changes place too — a fresh position, past every cursor,
 * where every device reads it again and lets go of the copy it held.
 */
function takeLineIntoTurn(context: WriterContext, turnId: string, id: string): Write<number> {
  return Effect.gen(function* () {
    const seq = yield* allocateMessageSeq(context);
    yield* placeMessageInTurn({ id, turnId, seq });
    return seq;
  });
}

/**
 * A turn's work follows the ask it answers. The developer's line normally
 * lands before the turn's first step writes the journal; where it lands
 * after — the voice writer's cut of the transcript racing eve's first step —
 * the rows the turn wrote ahead of it move behind it, each to a fresh
 * position, so the order the sequence states is the order that happened,
 * and a device that previewed the journal reads it again where it now
 * stands. Every row here is the turn's own, so a second ask's line the same
 * turn folded in keeps its place ahead.
 */
function moveTurnWorkAfter(context: WriterContext, turnId: string, seq: number): Write<void> {
  return Effect.gen(function* () {
    const ahead = yield* findTurnWorkBefore({
      conversationId: context.target.conversationId,
      turnId,
      seq,
    });
    for (const row of ahead) {
      yield* moveMessage({ id: row.id, seq: yield* allocateMessageSeq(context) });
    }
  });
}

function attachAskLines(context: WriterContext, turnId: string): Write<AskLinesAttached> {
  return Effect.gen(function* () {
    const standing = yield* findUnattachedAskLines({
      conversationId: context.target.conversationId,
      turnId,
    });
    const attached: string[] = [];
    for (const row of standing) {
      yield* takeLineIntoTurn(context, turnId, row.id);
      attached.push(row.id);
    }
    return { ok: true, attached };
  });
}

/**
 * One event about a message. A claim is the one kind the schema makes
 * exclusive, and under the conversation's lock the check for a standing claim
 * holds when the insert runs, so the second claimant is answered by name and
 * the partial unique index stays the backstop it is. The kinds a write names
 * in `unless` are checked the same way, so a speech transition decided
 * against the events a caller read is refused as superseded when another
 * landed between the read and the lock, rather than re-opening a settled
 * offer by landing after it.
 */
function recordEvent(
  context: WriterContext,
  event: EventWrite | SpeechEventWrite,
): Write<EventWriteResult> {
  return Effect.gen(function* () {
    const { conversationId, userId } = context.target;
    const message = yield* findMessageInConversation({
      messageId: event.messageId,
      conversationId,
    });
    if (Option.isNone(message)) return { ok: false, refusal: STORE_WRITE_REFUSAL.NO_MESSAGE };
    const claiming = event.kind === CONVERSATION_EVENT_KIND.SPEECH_CLAIMED;
    const excluding: ConversationEventKind[] = [
      ...(claiming ? [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED] : []),
      ...("unless" in event ? event.unless : []),
    ];
    if (excluding.length > 0) {
      const standing = yield* findEventKinds({ messageId: event.messageId, kinds: excluding });
      if (standing.some((row) => claiming && row.kind === CONVERSATION_EVENT_KIND.SPEECH_CLAIMED)) {
        return { ok: false, refusal: STORE_WRITE_REFUSAL.ALREADY_CLAIMED };
      }
      if (standing.length > 0) return { ok: false, refusal: STORE_WRITE_REFUSAL.SUPERSEDED };
    }
    const seq = yield* allocateEventSeq(context);
    const inserted = yield* insertEvent({
      userId,
      conversationId,
      seq,
      messageId: event.messageId,
      kind: event.kind,
      deviceId: nullable(event.deviceId),
      payload: nullable(event.payload),
      createdAt: context.now(),
    });
    const written = yield* required(inserted, "the event insert answered no row");
    return { ok: true, id: written.id, seq };
  });
}

/**
 * Composes the writer over one catalog, which is where the catalog is held to
 * the unknown outcome's envelope: a tool whose declared output schema refuses
 * it would leave a dispatched call's row unreadable, so the writer refuses to
 * exist over such a catalog rather than writing one.
 */
export function storeWriter({
  tools,
  now = () => new Date(),
}: StoreWriterOptions): Effect.Effect<StoreWriter> {
  /**
   * Runs one write under the conversation's row lock, or answers that no such
   * conversation stands for this account: none by that id, or one Clear
   * already stamped, which is read by nothing and so written by nothing.
   */
  function underConversation<Result>(
    target: ConversationTarget,
    write: (context: WriterContext) => Write<Result>,
  ): Write<Result | typeof NO_CONVERSATION> {
    return Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql.withTransaction(
        Effect.flatMap(
          lockConversation(target),
          (locked): Write<Result | typeof NO_CONVERSATION> =>
            Option.isNone(locked) ? Effect.succeed(NO_CONVERSATION) : write({ tools, now, target }),
        ),
      ),
    );
  }

  const writer: StoreWriter = {
    consume: (target, event) => underConversation(target, (context) => consume(context, event)),
    enqueueTurn: (target, enqueue) =>
      underConversation(target, (context) => enqueueTurn(context, enqueue)),
    dequeueTurn: (target, turnId) =>
      underConversation(target, (context) => dequeueTurn(context, turnId)),
    requestTurnCancel: (target, cancel) =>
      underConversation(target, (context) => requestTurnCancel(context, cancel)),
    recordCompaction: (target, compaction) =>
      underConversation(target, (context) => recordCompaction(context, compaction)),
    recordEvent: (target, event) =>
      underConversation(target, (context) => recordEvent(context, event)),
    recordUserMessage: (target, message) =>
      underConversation(target, (context) => recordUserMessage(context, message)),
    attachAskLines: (target, turnId) =>
      underConversation(target, (context) => attachAskLines(context, turnId)),
    spokenAskEnd: (target, end) =>
      underConversation(target, (context) => spokenAskEnd(context, end)),
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
