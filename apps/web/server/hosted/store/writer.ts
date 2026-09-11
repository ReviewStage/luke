import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  asSchema,
  type ReasoningUIPart,
  type ToolSet,
  type ToolUIPart,
  type UIMessage,
  type UITools,
} from "ai";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
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
} from "../../core.js";
import { conversations, events, messages, turns } from "../../db/storage-schema.js";
import { type HostedStoreDatabase, nullable } from "./database.js";

/**
 * The store writer: the one path by which a `messages`, `turns`, or `events`
 * row is written. It consumes the brain's run event stream (`BrainRunEvent`,
 * every kind of turn) and keeps the record the plan describes: a turn row
 * from queued through running to its end, one assistant message per turn
 * that is the turn's journal while it runs — each tool call written in
 * `input-available` before it executes and moved to `output-available` or
 * `output-error` as its result lands, `finished_at` set once and the row
 * immutable after — the user messages the turn opened with, and a compaction
 * message where the compaction's owner hands one over. Every write is
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
 */

/** The one output any tool's schema must admit: the envelope of a call whose effect is unknown. */
const UNKNOWN_OUTCOME_PROBE = unknownActionOutput(
  "the call was dispatched and its effect is unknown",
);

/** The tools whose declared output schema would refuse the unknown outcome's envelope. */
async function toolsRefusingUnknownOutcome(tools: ToolSet): Promise<readonly string[]> {
  const refusing: string[] = [];
  for (const [name, declared] of Object.entries(tools)) {
    if (declared.outputSchema === undefined) continue;
    const validate = asSchema(declared.outputSchema).validate;
    if (validate === undefined) continue;
    const result = await validate(UNKNOWN_OUTCOME_PROBE);
    if (!result.success) refusing.push(name);
  }
  return refusing;
}

export interface ConversationTarget {
  readonly userId: string;
  readonly conversationId: string;
}

interface StoreWriterOptions {
  readonly db: HostedStoreDatabase;
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
 * would change is closed, the claim it makes is already another's, or what it
 * carries is outside the vocabulary.
 */
export const STORE_WRITE_REFUSAL = {
  NO_CONVERSATION: "no_conversation",
  NO_TURN: "no_turn",
  NO_CALL: "no_call",
  NO_MESSAGE: "no_message",
  FINISHED: "finished",
  ALREADY_CLAIMED: "already_claimed",
  MESSAGE_REFUSED: "message_refused",
} as const;

type StoreWriteRefusal = (typeof STORE_WRITE_REFUSAL)[keyof typeof STORE_WRITE_REFUSAL];

type Refused<Refusal extends StoreWriteRefusal> = { readonly ok: false; readonly refusal: Refusal };

const NO_CONVERSATION: Refused<typeof STORE_WRITE_REFUSAL.NO_CONVERSATION> = {
  ok: false,
  refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION,
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
  readonly origin: TurnOrigin;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly promptHash?: string;
  readonly toolSetHash?: string;
}

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
  readonly text: string;
  readonly metadata: UserMessageMetadata;
}

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

interface EventWrite {
  readonly messageId: string;
  readonly kind: ConversationEventKind;
  readonly deviceId?: string;
  readonly payload?: UnparsedWireValue;
}

type EventWriteResult =
  | { readonly ok: true; readonly id: string; readonly seq: number }
  | Refused<
      | typeof STORE_WRITE_REFUSAL.NO_CONVERSATION
      | typeof STORE_WRITE_REFUSAL.NO_MESSAGE
      | typeof STORE_WRITE_REFUSAL.ALREADY_CLAIMED
    >;

export interface StoreWriter {
  /** Consumes one event of the run stream for the conversation it names. */
  consume(target: ConversationTarget, event: BrainRunEvent): Promise<StoreWriteResult>;
  /** Writes a turn as queued, ahead of the stream telling its start; answers the turn's id. */
  enqueueTurn(target: ConversationTarget, enqueue: TurnEnqueue): Promise<TurnEnqueueResult>;
  /** Writes the assistant message a compaction stands as; the stream's own compaction event carries too little to write it. */
  recordCompaction(
    target: ConversationTarget,
    compaction: CompactionWrite,
  ): Promise<StoreWriteResult>;
  /** Appends one event about a message, numbered by the conversation's event sequence. */
  recordEvent(target: ConversationTarget, event: EventWrite): Promise<EventWriteResult>;
  /** Writes the developer's own words as a finished user message, once per client id. */
  recordUserMessage(
    target: ConversationTarget,
    message: UserMessageWrite,
  ): Promise<UserMessageWriteResult>;
  /** The latest end, on the session's clock, of the spoken asks already written for one voice session; zero for none. */
  spokenAskEnd(target: ConversationTarget, end: SpokenAskEnd): Promise<SpokenAskEndResult>;
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

interface MessageRow {
  readonly id: string;
  readonly parts: Parts;
  readonly metadata: StoredMessageMetadata | null;
  readonly finishedAt: Date | null;
}

const BRAIN_AUTHORED = { author: MESSAGE_AUTHOR.BRAIN } as const;

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
  readonly tx: HostedStoreDatabase;
  readonly tools: ToolSet;
  readonly now: () => Date;
  readonly target: ConversationTarget;
}

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
async function admitted(
  context: WriterContext,
  message: UIMessage | StoredUIMessage,
): Promise<Admitted> {
  const read = await readStoredUIMessages(
    unparsedWire([JSON.parse(JSON.stringify(message))]),
    context.tools,
  );
  if (!read.ok) {
    return {
      ok: false,
      refusal: STORE_WRITE_REFUSAL.MESSAGE_REFUSED,
      reason: read.refusal,
      path: read.path,
    };
  }
  const [stored] = read.value;
  if (stored === undefined) throw new Error("the reader answered no row for one message");
  return { ok: true, message: stored };
}

/**
 * The next position of the conversation's message sequence: the counter's
 * own, or one past the highest position a row already holds where the
 * counter fell behind it, and the counter moved past whichever was handed
 * out. The read of `max(seq)` is served by the unique index over the pair.
 */
async function allocateMessageSeq(context: WriterContext): Promise<number> {
  const { conversationId } = context.target;
  const [row] = await context.tx
    .update(conversations)
    .set({
      nextMessageSeq: sql`greatest(${conversations.nextMessageSeq}, (select coalesce(max(${messages.seq}), 0) + 1 from ${messages} where ${messages.conversationId} = ${conversationId})) + 1`,
      lastActivityAt: context.now(),
    })
    .where(eq(conversations.id, conversationId))
    .returning({ next: conversations.nextMessageSeq });
  if (row === undefined) throw new Error("the conversation vanished under its own lock");
  return row.next - 1;
}

async function allocateEventSeq(context: WriterContext): Promise<number> {
  const { conversationId } = context.target;
  const [row] = await context.tx
    .update(conversations)
    .set({
      nextEventSeq: sql`greatest(${conversations.nextEventSeq}, (select coalesce(max(${events.seq}), 0) + 1 from ${events} where ${events.conversationId} = ${conversationId})) + 1`,
    })
    .where(eq(conversations.id, conversationId))
    .returning({ next: conversations.nextEventSeq });
  if (row === undefined) throw new Error("the conversation vanished under its own lock");
  return row.next - 1;
}

async function turnRow(
  context: WriterContext,
  turnId: string,
): Promise<{ status: TurnStatus } | undefined> {
  const [row] = await context.tx
    .select({ status: turns.status })
    .from(turns)
    .where(and(eq(turns.id, turnId), eq(turns.conversationId, context.target.conversationId)));
  return row;
}

async function messageByClientId(
  context: WriterContext,
  clientId: string,
): Promise<MessageRow | undefined> {
  const [row] = await context.tx
    .select({
      id: messages.id,
      parts: messages.parts,
      metadata: messages.metadata,
      finishedAt: messages.finishedAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, context.target.conversationId),
        eq(messages.clientId, clientId),
      ),
    );
  return row;
}

async function insertMessage(
  context: WriterContext,
  row: {
    clientId: string;
    turnId: string | undefined;
    message: StoredUIMessage;
    finishedAt: Date | undefined;
  },
): Promise<string> {
  const seq = await allocateMessageSeq(context);
  const metadata: StoredMessageMetadata | undefined =
    row.message.role === MESSAGE_ROLE.SYSTEM ? undefined : row.message.metadata;
  const [inserted] = await context.tx
    .insert(messages)
    .values({
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
    })
    .returning({ id: messages.id });
  if (inserted === undefined) throw new Error("the message insert answered no row");
  return inserted.id;
}

type Journal =
  | { readonly ok: true; readonly row: MessageRow }
  | Refused<typeof STORE_WRITE_REFUSAL.NO_TURN | typeof STORE_WRITE_REFUSAL.FINISHED>;

/** Whether a turn may still take a new message or part: it stands, and it has not ended. */
async function openTurn(
  context: WriterContext,
  turnId: string,
): Promise<
  Refused<typeof STORE_WRITE_REFUSAL.NO_TURN | typeof STORE_WRITE_REFUSAL.FINISHED> | undefined
> {
  const turn = await turnRow(context, turnId);
  if (turn === undefined) return { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN };
  if (TERMINAL_TURN_STATUSES.has(turn.status)) {
    return { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED };
  }
  return undefined;
}

/**
 * The turn's one assistant message, the journal of the turn under way: keyed
 * by the turn's id as its client id, opened by the first part the turn
 * reports while the turn still runs, and closed by the turn's answer or its
 * end. A turn that has ended opens no journal after the fact.
 */
async function journal(context: WriterContext, turnId: string): Promise<Journal> {
  const standing = await messageByClientId(context, turnId);
  if (standing !== undefined) return { ok: true, row: standing };
  const closed = await openTurn(context, turnId);
  if (closed !== undefined) return closed;
  const id = await insertMessage(context, {
    clientId: turnId,
    turnId,
    message: { id: turnId, role: MESSAGE_ROLE.ASSISTANT, metadata: BRAIN_AUTHORED, parts: [] },
    finishedAt: undefined,
  });
  return { ok: true, row: { id, parts: [], metadata: BRAIN_AUTHORED, finishedAt: null } };
}

/** Writes the journal's parts as they now stand, held to the vocabulary first. */
async function amendJournal(
  context: WriterContext,
  row: MessageRow,
  parts: Parts,
): Promise<StoreWriteResult> {
  const read = await admitted(context, {
    id: row.id,
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: BRAIN_AUTHORED,
    parts,
  });
  if (!read.ok) return read;
  await context.tx
    .update(messages)
    .set({ parts: read.message.parts })
    .where(eq(messages.id, row.id));
  return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
}

async function turnStarted(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.TURN_STARTED }>,
): Promise<StoreWriteResult> {
  const standing = await turnRow(context, event.turnId);
  const startedAt = new Date(event.at);
  if (standing === undefined) {
    await context.tx.insert(turns).values({
      id: event.turnId,
      userId: context.target.userId,
      conversationId: context.target.conversationId,
      origin: TURN_ORIGIN_OF_BRAIN_ORIGIN[event.origin],
      status: TURN_STATUS.RUNNING,
      queuedAt: startedAt,
      startedAt,
    });
    return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
  }
  if (standing.status !== TURN_STATUS.QUEUED) {
    return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
  }
  await context.tx
    .update(turns)
    .set({ status: TURN_STATUS.RUNNING, startedAt })
    .where(eq(turns.id, event.turnId));
  return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
}

async function turnEnded(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.TURN_ENDED }>,
): Promise<StoreWriteResult> {
  const standing = await turnRow(context, event.turnId);
  if (standing === undefined) return { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN };
  if (TERMINAL_TURN_STATUSES.has(standing.status)) {
    return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
  }
  const settledAt = new Date(event.at);
  const status = turnStatusOf(event.status);
  // A failed turn names its failure word where the run had one, and the status
  // it ended in otherwise, so a timed-out or interrupted turn still says which.
  const failure = event.failure ?? (status === TURN_STATUS.FAILED ? event.status : undefined);
  await context.tx
    .update(turns)
    .set({
      status,
      settledAt,
      failure: nullable(failure),
      usage: nullable(event.usage),
      responseIds: [...event.responseIds],
    })
    .where(eq(turns.id, event.turnId));
  const open = await messageByClientId(context, event.turnId);
  if (open !== undefined && open.finishedAt === null) {
    const parts = open.parts.map((part) =>
      isStoredToolPart(part) && !isSettledToolPartState(part.state)
        ? unansweredToolPart(part, event.status)
        : part,
    );
    await context.tx
      .update(messages)
      .set({ parts, finishedAt: settledAt })
      .where(eq(messages.id, open.id));
  }
  return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
}

async function toolCallStarted(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.TOOL_CALL_STARTED }>,
): Promise<StoreWriteResult> {
  const opened = await journal(context, event.turnId);
  if (!opened.ok) return opened;
  const { row } = opened;
  if (toolPartOf(row.parts, event.callId) !== undefined) {
    return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
  }
  if (row.finishedAt !== null) return { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED };
  return amendJournal(context, row, [
    ...row.parts,
    pendingToolPart(event.name, event.callId, event.input),
  ]);
}

async function toolCallSettled(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.TOOL_CALL_SETTLED }>,
): Promise<StoreWriteResult> {
  const row = await messageByClientId(context, event.turnId);
  if (row === undefined) {
    return {
      ok: false,
      refusal:
        (await turnRow(context, event.turnId)) === undefined
          ? STORE_WRITE_REFUSAL.NO_TURN
          : STORE_WRITE_REFUSAL.NO_CALL,
    };
  }
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
  return amendJournal(context, row, parts);
}

/**
 * A reasoning summary joins the journal under its item's id. An item that
 * names no id is not journaled: nothing could tell its second delivery from
 * a second item, and the turn's completed projection carries every summary
 * under the id the adapter lifted for it.
 */
async function reasoningCompleted(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.REASONING_COMPLETED }>,
): Promise<StoreWriteResult> {
  const { id } = event.item;
  if (!isWireString(id)) return { ok: true, effect: STORE_WRITE_EFFECT.IGNORED };
  const opened = await journal(context, event.turnId);
  if (!opened.ok) return opened;
  const { row } = opened;
  if (row.parts.some((part) => part.type === UI_PART_TYPE.REASONING && part.id === id)) {
    return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
  }
  if (row.finishedAt !== null) return { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED };
  return amendJournal(context, row, [...row.parts, reasoningPart(event.summary, id)]);
}

/**
 * A completed message: a user message lands as its own row by its id; the
 * turn's answer closes the turn's journal, its parts replaced whole by the
 * projection the turn told, since the projection is the message as the
 * runtime's own record has it and the journal was the record of it in flight.
 * A closed journal takes the same projection again as a repeat and a
 * different one as the late write it is.
 */
async function messageCompleted(
  context: WriterContext,
  event: Extract<BrainRunEvent, { kind: typeof BRAIN_RUN_EVENT.MESSAGE_COMPLETED }>,
): Promise<StoreWriteResult> {
  const read = await admitted(context, event.message);
  if (!read.ok) return read;
  const { message } = read;
  if (message.role !== MESSAGE_ROLE.ASSISTANT) {
    if ((await messageByClientId(context, message.id)) !== undefined) {
      return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
    }
    const closed = await openTurn(context, event.turnId);
    if (closed !== undefined) return closed;
    await insertMessage(context, {
      clientId: message.id,
      turnId: event.turnId,
      message,
      finishedAt: context.now(),
    });
    return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
  }
  const opened = await journal(context, event.turnId);
  if (!opened.ok) return opened;
  const { row } = opened;
  if (row.finishedAt !== null) {
    return isDeepStrictEqual(row.parts, message.parts)
      ? { ok: true, effect: STORE_WRITE_EFFECT.REPEATED }
      : { ok: false, refusal: STORE_WRITE_REFUSAL.FINISHED };
  }
  await context.tx
    .update(messages)
    .set({ parts: message.parts, metadata: message.metadata, finishedAt: context.now() })
    .where(eq(messages.id, row.id));
  return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
}

function consume(context: WriterContext, event: BrainRunEvent): Promise<StoreWriteResult> {
  switch (event.kind) {
    case BRAIN_RUN_EVENT.TURN_STARTED:
      return turnStarted(context, event);
    case BRAIN_RUN_EVENT.TURN_ENDED:
      return turnEnded(context, event);
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
      return Promise.resolve({ ok: true, effect: STORE_WRITE_EFFECT.IGNORED });
  }
}

async function enqueueTurn(
  context: WriterContext,
  enqueue: TurnEnqueue,
): Promise<TurnEnqueueResult> {
  const turnId = enqueue.turnId ?? randomUUID();
  if ((await turnRow(context, turnId)) !== undefined) {
    return { ok: true, turnId, effect: STORE_WRITE_EFFECT.REPEATED };
  }
  await context.tx.insert(turns).values({
    id: turnId,
    userId: context.target.userId,
    conversationId: context.target.conversationId,
    origin: enqueue.origin,
    status: TURN_STATUS.QUEUED,
    model: nullable(enqueue.model),
    reasoningEffort: nullable(enqueue.reasoningEffort),
    promptHash: nullable(enqueue.promptHash),
    toolSetHash: nullable(enqueue.toolSetHash),
    queuedAt: context.now(),
  });
  return { ok: true, turnId, effect: STORE_WRITE_EFFECT.WRITTEN };
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
async function recordCompaction(
  context: WriterContext,
  compaction: CompactionWrite,
): Promise<StoreWriteResult> {
  const standing = await messageByClientId(context, compaction.clientId);
  if (standing !== undefined) {
    if (!isCompactionRow(standing)) {
      throw new Error("a compaction's client id names a message that is not a compaction");
    }
    return { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
  }
  if (
    compaction.turnId !== undefined &&
    (await turnRow(context, compaction.turnId)) === undefined
  ) {
    return { ok: false, refusal: STORE_WRITE_REFUSAL.NO_TURN };
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
  const read = await admitted(context, built);
  if (!read.ok) return read;
  await insertMessage(context, {
    clientId: compaction.clientId,
    turnId: compaction.turnId,
    message: read.message,
    finishedAt: context.now(),
  });
  return { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
}

async function spokenAskEnd(
  context: WriterContext,
  end: SpokenAskEnd,
): Promise<SpokenAskEndResult> {
  const [row] = await context.tx
    .select({ toMs: sql<number>`coalesce(max((${messages.metadata} ->> 'to_ms')::int), 0)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, context.target.conversationId),
        ne(messages.clientId, end.delegationId),
        sql`${messages.metadata} ->> 'voice_session_id' = ${end.voiceSessionId}`,
      ),
    );
  return { ok: true, toMs: row?.toMs ?? 0 };
}

async function recordUserMessage(
  context: WriterContext,
  write: UserMessageWrite,
): Promise<UserMessageWriteResult> {
  const standing = await messageByClientId(context, write.clientId);
  if (standing !== undefined) {
    return { ok: true, id: standing.id, effect: STORE_WRITE_EFFECT.REPEATED };
  }
  const read = await admitted(context, {
    id: write.clientId,
    role: MESSAGE_ROLE.USER,
    metadata: write.metadata,
    parts: [{ type: UI_PART_TYPE.TEXT, text: write.text, state: UI_PART_STATE.DONE }],
  });
  if (!read.ok) return read;
  const id = await insertMessage(context, {
    clientId: write.clientId,
    turnId: write.turnId,
    message: read.message,
    finishedAt: context.now(),
  });
  return { ok: true, id, effect: STORE_WRITE_EFFECT.WRITTEN };
}

/**
 * One event about a message. A claim is the one kind the schema makes
 * exclusive, and under the conversation's lock the check for a standing claim
 * holds when the insert runs, so the second claimant is answered by name and
 * the partial unique index stays the backstop it is.
 */
async function recordEvent(context: WriterContext, event: EventWrite): Promise<EventWriteResult> {
  const { conversationId, userId } = context.target;
  const [message] = await context.tx
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, event.messageId), eq(messages.conversationId, conversationId)));
  if (message === undefined) return { ok: false, refusal: STORE_WRITE_REFUSAL.NO_MESSAGE };
  if (event.kind === CONVERSATION_EVENT_KIND.SPEECH_CLAIMED) {
    const [claimed] = await context.tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.messageId, event.messageId),
          eq(events.kind, CONVERSATION_EVENT_KIND.SPEECH_CLAIMED),
        ),
      );
    if (claimed !== undefined) return { ok: false, refusal: STORE_WRITE_REFUSAL.ALREADY_CLAIMED };
  }
  const seq = await allocateEventSeq(context);
  const [inserted] = await context.tx
    .insert(events)
    .values({
      userId,
      conversationId,
      seq,
      messageId: event.messageId,
      kind: event.kind,
      deviceId: nullable(event.deviceId),
      payload: nullable(event.payload),
      createdAt: context.now(),
    })
    .returning({ id: events.id });
  if (inserted === undefined) throw new Error("the event insert answered no row");
  return { ok: true, id: inserted.id, seq };
}

export async function storeWriter({
  db,
  tools,
  now = () => new Date(),
}: StoreWriterOptions): Promise<StoreWriter> {
  const refusing = await toolsRefusingUnknownOutcome(tools);
  if (refusing.length > 0) {
    throw new Error(
      `the output schema of ${refusing.join(", ")} does not admit the unknown outcome's envelope`,
    );
  }
  /**
   * Runs one write under the conversation's row lock, or answers that no such
   * conversation stands for this account: none by that id, or one Clear
   * already stamped, which is read by nothing and so written by nothing.
   */
  function underConversation<Result>(
    target: ConversationTarget,
    write: (context: WriterContext) => Promise<Result>,
  ): Promise<Result | typeof NO_CONVERSATION> {
    return db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, target.conversationId),
            eq(conversations.userId, target.userId),
            isNull(conversations.deletedAt),
          ),
        )
        .for("update");
      if (locked.length === 0) return NO_CONVERSATION;
      return write({ tx, tools, now, target });
    });
  }

  return {
    consume: (target, event) => underConversation(target, (context) => consume(context, event)),
    enqueueTurn: (target, enqueue) =>
      underConversation(target, (context) => enqueueTurn(context, enqueue)),
    recordCompaction: (target, compaction) =>
      underConversation(target, (context) => recordCompaction(context, compaction)),
    recordEvent: (target, event) =>
      underConversation(target, (context) => recordEvent(context, event)),
    recordUserMessage: (target, message) =>
      underConversation(target, (context) => recordUserMessage(context, message)),
    spokenAskEnd: (target, end) =>
      underConversation(target, (context) => spokenAskEnd(context, end)),
  };
}
