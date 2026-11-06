import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { type AutomationFiring, FIRING_HANDS_OUTSIDE_WORDS } from "@repo/features/automation-wire";
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
} from "@repo/features/turn-run";
import {
  type AgentMessageMetadata,
  type AppLineMetadata,
  type AutomationLineMetadata,
  type CommentLineMetadata,
  type GitHubLineMetadata,
  isWireString,
  jsonRoundTrip,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type SchemaPath,
  type SchemaRefusal,
  type SlackLineMetadata,
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
} from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import {
  isSettledToolPartState,
  isStoredToolPart,
  readStoredUIMessages,
  type StoredToolPart,
  type StoredUIMessage,
  TOOL_PART_STATE,
} from "@repo/wire/ui-messages";
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
import { CONVERSATION_KIND, MESSAGE_SENDER, messageSenderSchema } from "../storage-vocabulary.js";
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

function unknownOutcome(reason: string) {
  return { status: UNKNOWN_ACTION_STATUS, reason } as const;
}

const UNKNOWN_OUTCOME_PROBE = unknownOutcome("the call was dispatched and its effect is unknown");

const toolsRefusingUnknownOutcome = (tools: ToolSet): Effect.Effect<readonly string[]> =>
  Effect.map(
    Effect.forEach(Object.entries(tools), ([name, declared]) => {
      if (declared.outputSchema === undefined) return Effect.succeed(undefined);
      const validate = asSchema(declared.outputSchema).validate;
      if (validate === undefined) return Effect.succeed(undefined);
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
  readonly tools: ToolSet;
}

export interface SettledAgentTurn {
  readonly userId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly status: TurnStatus;
  readonly failure: string | null;
  readonly ranMs: number;
}

export class SettledTurnListener extends Context.Service<
  SettledTurnListener,
  { readonly heard: (turn: SettledAgentTurn) => Effect.Effect<void, never, DatabaseServices> }
>()("SettledTurnListener") {}

export const STORE_WRITE_EFFECT = {
  WRITTEN: "written",
  REPEATED: "repeated",
  IGNORED: "ignored",
} as const;

type StoreWriteEffect = (typeof STORE_WRITE_EFFECT)[keyof typeof STORE_WRITE_EFFECT];

export const STORE_WRITE_REFUSAL = {
  NO_CONVERSATION: "no_conversation",
  NO_TURN: "no_turn",
  NO_CALL: "no_call",
  FINISHED: "finished",
  MESSAGE_REFUSED: "message_refused",
  BUSY: "busy",
} as const;

type StoreWriteRefusal = (typeof STORE_WRITE_REFUSAL)[keyof typeof STORE_WRITE_REFUSAL];

type Refused<Refusal extends StoreWriteRefusal> = { readonly refusal: Refusal };

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

const CONVERSATION_BUSY: Refused<typeof STORE_WRITE_REFUSAL.BUSY> = {
  refusal: STORE_WRITE_REFUSAL.BUSY,
};

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

interface TurnEnqueue {
  readonly turnId?: string;
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
  readonly key?: string;
  readonly by?: string;
}

type TurnCancelResult = Result.Result<StoreWriteEffect, typeof NO_CONVERSATION | typeof NO_TURN>;

type TurnEnqueueResult = Result.Result<
  { readonly turnId: string; readonly effect: StoreWriteEffect },
  typeof NO_CONVERSATION
>;

export type LineSender =
  | { readonly kind: typeof MESSAGE_SENDER.MEMBER; readonly userId: string }
  | { readonly kind: typeof MESSAGE_SENDER.APP }
  | {
      readonly kind: typeof MESSAGE_SENDER.AUTOMATION;
      readonly automationId: string | undefined;
      readonly name: string;
    }
  | { readonly kind: typeof MESSAGE_SENDER.GITHUB; readonly login: string }
  | {
      readonly kind: typeof MESSAGE_SENDER.AGENT;
      readonly agentId: string;
      readonly name: string;
      readonly model: string;
    };

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

interface AwaitingLineWrite {
  readonly text: string;
  readonly clientKey: string;
  readonly attachments?: readonly HandedFile[] | undefined;
  readonly mentioned?: string | undefined;
  readonly sender: LineSender;
  readonly metadata?: AwaitingLineMetadata | undefined;
}

export type AwaitingLineMetadata =
  | TypedAskMetadata
  | AgentMessageMetadata
  | ThreadLineMetadata
  | CommentLineMetadata
  | StartLineMetadata
  | GitHubLineMetadata
  | AppLineMetadata
  | AutomationLineMetadata
  | SlackLineMetadata;

const TYPED_LINE_METADATA: TypedAskMetadata = {
  channel: MESSAGE_CHANNEL.TYPED,
};

export const APP_LINE_METADATA: AppLineMetadata = { channel: MESSAGE_CHANNEL.APP };

export function automationLineMetadata(firing: AutomationFiring): AutomationLineMetadata {
  return {
    channel: MESSAGE_CHANNEL.AUTOMATION,
    outside_words: FIRING_HANDS_OUTSIDE_WORDS[firing.kind],
  };
}

type AwaitingLineWritten = Result.Result<
  Option.Option<{
    readonly id: string;
    readonly effect: StoreWriteEffect;
    readonly txid?: string;
  }>,
  typeof NO_CONVERSATION | typeof CONVERSATION_BUSY | MessageRefused
>;

type AwaitingLineTake =
  | { readonly text: string; readonly turnId: string }
  | { readonly clientId: string; readonly turnId: string };

const AWAITING_LINE_DISPATCH_DEADLINE = Duration.seconds(30);

type AwaitingLineTaken = Result.Result<readonly string[], typeof NO_CONVERSATION | typeof NO_TURN>;

export interface StoreWriter {
  consume(target: ConversationTarget, event: RunEvent): Write<StoreWriteResult>;
  consumeAll(
    target: ConversationTarget,
    events: readonly RunEvent[],
  ): Write<readonly StoreWriteResult[]>;
  enqueueTurn(target: ConversationTarget, enqueue: TurnEnqueue): Write<TurnEnqueueResult>;
  requestTurnCancel(target: ConversationTarget, cancel: TurnCancelRequest): Write<TurnCancelResult>;
  writeAwaitingLine(
    target: ConversationTarget,
    line: AwaitingLineWrite,
    dispatch: Effect.Effect<boolean>,
  ): Write<AwaitingLineWritten>;
  takeAwaitingLine(target: ConversationTarget, take: AwaitingLineTake): Write<AwaitingLineTaken>;
}

const TURN_ORIGIN_OF_RUN_ORIGIN = {
  [RUN_TURN_ORIGIN.TYPED]: TURN_ORIGIN.TYPED,
  [RUN_TURN_ORIGIN.SPOKEN]: TURN_ORIGIN.SPOKEN,
  [RUN_TURN_ORIGIN.CHILD]: TURN_ORIGIN.CHILD,
} as const satisfies Record<RunTurnOrigin, TurnOrigin>;

function turnStatusOf(status: RunStatus): TurnStatus {
  switch (status) {
    case RUN_STATUS.SUCCEEDED:
      return TURN_STATUS.SETTLED;
    case RUN_STATUS.CANCELED:
      return TURN_STATUS.CANCELED;
    case RUN_STATUS.FAILED:
    case RUN_STATUS.TIMED_OUT:
    case RUN_STATUS.INTERRUPTED:
    case RUN_STATUS.QUEUED:
    case RUN_STATUS.RUNNING:
      return TURN_STATUS.FAILED;
  }
}

const TURN_FAILURE_DETAIL = { CHARS: 2000 } as const;

const TERMINAL_TURN_STATUSES: ReadonlySet<TurnStatus> = new Set([
  TURN_STATUS.SETTLED,
  TURN_STATUS.CANCELED,
  TURN_STATUS.FAILED,
]);

type ToolPart = ToolUIPart<UITools>;

type Parts = StoredUIMessage["parts"];

const MODEL_AUTHORED = { author: MESSAGE_AUTHOR.MODEL } as const;

function required<A>(row: Option.Option<A>, absent: string): Effect.Effect<A> {
  return Option.match(row, { onNone: () => Effect.die(new Error(absent)), onSome: Effect.succeed });
}

const readsJsonObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

const readsPartsShape = Schema.is(Schema.Array(Schema.Struct({ type: Schema.String })));

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

const InsertedRowSchema = Schema.Struct({ id: Schema.String, txid: Schema.String });

const CURRENT_TXID = sql<string>`pg_current_xact_id()::text`;

const SPOKEN_VOICE_SESSION_ID = sql`${messages.metadata} ->> 'voice_session_id'`;

const ConversationTargetSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
});

const SequenceSchema = Schema.Struct({ next: EpochMillisColumnSchema });

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
  sender: Schema.NullOr(messageSenderSchema),
  senderUserId: Schema.NullOr(Schema.String),
  senderName: Schema.NullOr(Schema.String),
  senderModel: Schema.NullOr(Schema.String),
  senderAgentId: Schema.NullOr(Schema.String),
  senderAutomationId: Schema.NullOr(Schema.String),
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
          senderAutomationId: row.senderAutomationId,
        })
        .returning({ id: messages.id, txid: CURRENT_TXID }),
    ),
});

const BUMPED_REVISION = "bumped";

const bumpedRevision = (conversationId: string) =>
  queryBuilder.$with(BUMPED_REVISION, { journalRevision: conversations.journalRevision }).as(
    sql`update ${conversations}
        set ${sql.identifier(conversations.journalRevision.name)} = ${conversations.journalRevision} + 1
        where ${eq(conversations.id, conversationId)}
        returning ${conversations.journalRevision}`,
  );

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

const UNANSWERED_REASON = {
  ENDED: "The turn ended before the call answered; it may have run.",
  CANCELED: "The turn was canceled before the call answered; it may have run.",
  RETRIED:
    "The step that asked for the call was run again before the call answered; it may have run.",
} as const;

type UnansweredReason = (typeof UNANSWERED_REASON)[keyof typeof UNANSWERED_REASON];

function unansweredToolPart(part: StoredToolPart, reason: UnansweredReason): ToolPart {
  return {
    type: part.type,
    toolCallId: part.toolCallId,
    state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
    input: part.input,
    output: unknownOutcome(reason),
  };
}

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

interface HeldJournal {
  readonly row: MessageRow;
  readonly dirty: boolean;
}

interface WriterContext {
  readonly tools: ToolSet;
  readonly now: Date;
  readonly target: ConversationTarget;
  readonly kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];
  readonly journals: Map<string, HeldJournal>;
  readonly settled: SettledAgentTurn[];
}

type AfterCommit = Pick<WriterContext, "settled">;

type Write<Result> = Effect.Effect<Result, StoreFailure, DatabaseServices>;

type Admitted = Result.Result<StoredUIMessage, MessageRefused>;

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

const allocateMessageSeq = Effect.fnUntraced(function* (
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

function journalRow(context: WriterContext, turnId: string): Write<Option.Option<MessageRow>> {
  const held = context.journals.get(turnId);
  if (held !== undefined) return Effect.succeed(Option.some(held.row));
  return Effect.tap(messageByClientId(context, turnId), (read) =>
    Effect.sync(() => {
      if (Option.isSome(read)) context.journals.set(turnId, { row: read.value, dirty: false });
    }),
  );
}

function holdJournal(context: WriterContext, turnId: string, row: MessageRow, dirty: boolean) {
  context.journals.set(turnId, { row, dirty });
}

const TRANSCRIPT_KINDS: ReadonlySet<string> = new Set([
  CONVERSATION_KIND.AGENT,
  CONVERSATION_KIND.CHILD,
]);

const JOURNAL_METRIC = {
  REWRITE_BYTES: Metric.histogram("app.transcript.journal_rewrite_bytes", {
    description: "Bytes of parts a landed journal amendment wrote, as the row's whole parts",
    boundaries: Metric.exponentialBoundaries({ start: 1024, factor: 2, count: 12 }),
  }),
} as const;

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

interface InsertedMessage {
  readonly id: string;
  readonly seq: number;
  readonly txid: string;
}

const insertMessage = Effect.fnUntraced(function* (
  context: WriterContext,
  row: {
    clientId: string;
    turnId: string | undefined;
    message: StoredUIMessage;
    finishedAt: Date | undefined;
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
    senderAutomationId:
      row.sender?.kind === MESSAGE_SENDER.AUTOMATION ? nullable(row.sender.automationId) : null,
  });
  const written = yield* required(inserted, "the message insert answered no row");
  return { id: written.id, seq, txid: written.txid };
});

type Journal = Result.Result<
  MessageRow,
  Refused<typeof STORE_WRITE_REFUSAL.NO_TURN | typeof STORE_WRITE_REFUSAL.FINISHED>
>;

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

const journal = Effect.fnUntraced(function* (
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

const amendJournal = Effect.fnUntraced(function* (
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

const turnStarted = Effect.fnUntraced(function* (
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

const turnEnded = Effect.fnUntraced(function* (
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
  if (context.kind === CONVERSATION_KIND.AGENT) {
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
  const open = yield* journalRow(context, event.turnId);
  if (Option.isSome(open) && open.value.finishedAt !== null) {
    yield* reviseJournal({ id: open.value.id, conversationId: context.target.conversationId });
  }
  if (Option.isSome(open) && open.value.finishedAt === null) {
    const reason =
      event.status === RUN_STATUS.CANCELED ? UNANSWERED_REASON.CANCELED : UNANSWERED_REASON.ENDED;
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

const settleRetriedCalls = Effect.fnUntraced(function* (
  context: WriterContext,
  turnId: string,
  row: MessageRow,
): Effect.fn.Return<StoreWriteResult, StoreFailure, DatabaseServices> {
  const boundary = row.parts.findLastIndex((part) => part.type === UI_PART_TYPE.STEP_START);
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

const stepStarted = Effect.fnUntraced(function* (
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

const toolCallStarted = Effect.fnUntraced(function* (
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

const toolCallSettled = Effect.fnUntraced(function* (
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
  const settled = settledToolPart(
    event.input === undefined ? found.part : { ...found.part, input: event.input },
    event.settlement,
  );
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

const reasoningCompleted = Effect.fnUntraced(function* (
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

const textDrafted = Effect.fnUntraced(function* (
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

const messageCompleted = Effect.fnUntraced(function* (
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

const enqueueTurn = Effect.fn("web/enqueueTurn")(function* (
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

const placed = alias(messages, "placed");
const later = alias(messages, "later");

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
            sql`${SPOKEN_VOICE_SESSION_ID} is null`,
            noReceiptOfLine(),
          ),
        )
        .orderBy(asc(messages.seq)),
    ),
});

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

const stepsBegun = (context: WriterContext, turnId: string): Write<number | null> =>
  Effect.map(journalRow(context, turnId), (journal) => {
    if (Option.isNone(journal)) return null;
    const steps = journal.value.parts.filter((part) => part.type === UI_PART_TYPE.STEP_START);
    return steps.length === 0 ? null : steps.length;
  });

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
      if (!received.startsWith(joined)) break;
    }
  }
  return [];
}

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

type LineClaimed = Result.Result<
  | { readonly id: string; readonly txid: string; readonly claim: string }
  | { readonly id: string; readonly effect: typeof STORE_WRITE_EFFECT.REPEATED },
  typeof NO_CONVERSATION | typeof CONVERSATION_BUSY | MessageRefused
>;

const claimLine = Effect.fnUntraced(function* (
  context: WriterContext,
  line: AwaitingLineWrite,
  place: number,
): Effect.fn.Return<LineClaimed, StoreFailure | DispatchClaimHeld, DatabaseServices> {
  if (yield* dispatchClaimStands(context.target.conversationId, place)) {
    return yield* new DispatchClaimHeld();
  }
  const clientId = sentLineId(line.clientKey);
  yield* deleteWithdrawnLine({ conversationId: context.target.conversationId, clientId });
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

const takeAwaitingLine = Effect.fnUntraced(function* (
  context: WriterContext,
  take: AwaitingLineTake,
): Effect.fn.Return<AwaitingLineTaken, StoreFailure, DatabaseServices> {
  if (Option.isNone(yield* turnRow(context, take.turnId))) return Result.fail(NO_TURN);
  const awaiting = yield* findAwaitingLines({ conversationId: context.target.conversationId });
  const runAmong = (lines: typeof awaiting) =>
    "clientId" in take
      ? lines.filter((line) => line.clientId === take.clientId)
      : coalescedRun(lines, take.text);
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

const requestTurnCancel = Effect.fn("web/requestTurnCancel")(function* (
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

export function storeWriter({ tools }: StoreWriterOptions): Effect.Effect<StoreWriter> {
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

  function locked<A, E = never>(
    target: ConversationTarget,
    write: (context: WriterContext) => Effect.Effect<A, StoreFailure | E, DatabaseServices>,
    absent: () => A,
  ): Effect.Effect<A, StoreFailure | E, DatabaseServices> {
    return Effect.flatMap(SqlClient.SqlClient, (client) => {
      const after: AfterCommit = { settled: [] };
      return client
        .withTransaction(
          Effect.gen(function* () {
            const row = yield* lockConversation(target);
            return yield* lockedWrite(target, row, after, write, absent);
          }),
        )
        .pipe(Effect.tap(() => settledAfterCommit(after.settled)));
    });
  }

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
