import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_DELEGATE_TOOL,
  CODING_AGENT_STATUS,
  type CodingAgentContext,
  type CodingAgentDelegationStart,
  type CodingAgentFailure,
  type CodingAgentStatus,
  type CodingAgentSubagentTitle,
  type CodingAgentUsage,
} from "@sidecar/hosted/coding-agent-wire";
import type { ToolSet } from "ai";
import { Clock, Duration, Effect, Option, Schedule, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  isSettledToolPartState,
  isStoredToolPart,
  MESSAGE_ROLE,
  type StoredUIMessage,
  storedToolName,
  TURN_STATUS,
} from "../../core.js";
import { childConversationId } from "../brain-host/ids.js";
import {
  awaitingLinesOf,
  type CodingAgent,
  type CodingAgentDelegation,
  delegationStartsOf,
  delegationTitlesOf,
  latestTurnsOf,
  readCodingAgentContext,
  readCodingAgentOfConversation,
  readDelegation,
  turnUsagesOf,
  untitledDelegationsSince,
} from "../coding-agent-store.js";
import { ModelCatalog, type OfferedModel } from "../model-catalog.js";
import {
  type ConversationTarget,
  listMessagesPast,
  type MessageCursor,
  type StoredMessageRecord,
} from "../store/index.js";
import { type LatestTurn, readMessageByClientId, turnsNamed } from "../store/message-reads.js";
import { CODER } from "./bounds.js";
import { codingAgentContextOf, contextWindowOf } from "./context.js";
import {
  type AgentStanding,
  codingAgentFailureOf,
  codingAgentRunStartedAt,
  codingAgentStatusOf,
} from "./status.js";
import { usageOfTurn, usageOfTurns } from "./usage.js";

/**
 * transcript.ts -- a coding agent's transcript past a cursor, held open while the agent runs.
 *
 * The transcript is the conversation's own `messages` rows: the plan the
 * agent was handed, and each turn's journal as the relay writes it, which
 * grows in place while the turn runs and is replaced by the finished answer
 * when it ends. A reader holds a cursor of two numbers, the highest message
 * sequence it has and the journal revision it last read at, so a row added
 * past the first or amended past the second is new to it. A read with
 * nothing new is held open while the agent is starting or its newest turn
 * still runs, looked at again every `MESSAGES_POLL` and let go at
 * `MESSAGES_HOLD`, so a tab hears each message as it lands without asking
 * every half second and a tab on an agent whose first turn has not landed
 * costs one held read per hold rather than a spin; an agent that has ended
 * answers at once, unless a message of the developer's awaits the turn it
 * will open, which reads as running and is held for. Every page carries the agent's status as it stood when
 * the page was read, and why where the newest turn failed, so the reader
 * learns the agent ended from the page that ends the hold and asks nothing
 * else, and what the agent has cost, its workers' turns included, and its
 * newest turn, each read once with the page that is answered rather than
 * on every look inside the hold, and on the agent's own transcript what
 * its model's context holds as its newest step left it (`context.ts`) and
 * when each worker its newest turn still waits on began. A turn's journal
 * carries when the turn began, by the rule the working line counts from,
 * and when the journal closed: the close is written with the journal's
 * last parts, so the page that carries them carries it too, where the
 * turn row's own settling may land a look later.
 * Note that a step's end is written a moment before the next step starts
 * and lands its parts in the journal, so the page that wakes on a step
 * carries the step before it. The wire spells the cursor as the two
 * numbers joined by a colon.
 */

const CURSOR_SEPARATOR = ":";

/** The cursor the wire carries, as the store reads it; the start for the start's own spelling. */
export function cursorOfWire(after: string): MessageCursor {
  const [seq, revision] = after.split(CURSOR_SEPARATOR);
  return { seq: Number(seq ?? 0), revision: Number(revision ?? 0) };
}

/** The cursor as the wire carries it. */
export function cursorToWire(cursor: MessageCursor): string {
  return `${cursor.seq}${CURSOR_SEPARATOR}${cursor.revision}`;
}

/** The cursor before every message, as the store reads it. */
export const CURSOR_START: MessageCursor = cursorOfWire(CODING_AGENT_CURSOR_START);

/** One row of the transcript as the route answers it: its message as the store holds it, and for a turn's journal when the turn began and closed, which is the wire's `CodingAgentMessage` once serialized. */
type TranscriptMessage = StoredUIMessage & {
  readonly startedAt?: number;
  readonly finishedAt?: number;
};

/** A page of the transcript as the route answers it: each row's message, the agent's status as it stood, and why where its newest turn failed. */
export interface TranscriptPage {
  readonly messages: readonly TranscriptMessage[];
  readonly cursor: MessageCursor;
  readonly status: CodingAgentStatus;
  /** When the run that status is read from began, as the agent's summary says it; absent while a line awaits its turn. */
  readonly runStartedAt?: number;
  readonly failureReason?: CodingAgentFailure;
  /** What the agent has cost over every turn it and its workers settled; absent before one has. */
  readonly usage?: CodingAgentUsage;
  /** What its newest turn cost; absent until that turn settles. */
  readonly turnUsage?: CodingAgentUsage;
  /** What the agent's model's context holds, on its own transcript; absent before its first step and on a worker's. */
  readonly context?: CodingAgentContext;
  /** The delegations its newest turn still waits on, with when each worker began, on its own transcript; absent while none runs and on a worker's. */
  readonly delegations?: readonly CodingAgentDelegationStart[];
  /** Every one of its workers titled so far, by the call that delegated it, on its own transcript; absent while none is and on a worker's. */
  readonly subagentTitles?: readonly CodingAgentSubagentTitle[];
}

type TranscriptEffect<A, R = never> = Effect.Effect<
  A,
  SqlError | Schema.SchemaError,
  SqlClient.SqlClient | R
>;

/** The newest turn as a page reads it: which it is, and what it ran under and cost; nothing before the first. */
type NewestTurn = LatestTurn | undefined;

/** The agent whose own transcript a page is, as its context is read: its row. */
type OwnAgent = Pick<CodingAgent, "id">;

/** The statuses a read waits through: more may still land. */
const WAITING_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** The agent's status now, read from its newest turn and whether a line awaits one, when that run began, and why where that turn failed. */
const statusNow = (target: ConversationTarget, createdAt: Date) =>
  Effect.gen(function* () {
    const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
    const awaiting = yield* awaitingLinesOf(target.userId, [target.conversationId]);
    const now = yield* Clock.currentTimeMillis;
    const turn = turns.get(target.conversationId);
    const lineAwaits = awaiting.has(target.conversationId);
    const status = codingAgentStatusOf(turn, { createdAt, now, lineAwaits });
    const runStartedAt = codingAgentRunStartedAt(turn, { createdAt, lineAwaits });
    const failureReason =
      status === CODING_AGENT_STATUS.FAILED ? codingAgentFailureOf(turn) : undefined;
    return { status, runStartedAt, failureReason, turn };
  });

/**
 * The agent's context as its row holds it, against the window the catalog
 * lists for the model and window the same read says it runs on now;
 * nothing before its first step. Note that the choice is read here rather
 * than taken from the agent the request read, because a change of model or
 * window during the hold is what the step this page carries ran on.
 */
const contextOf = (target: ConversationTarget, own: OwnAgent, offered: readonly OfferedModel[]) =>
  Effect.map(readCodingAgentContext(target.userId, own.id), (held) =>
    Option.isNone(held)
      ? undefined
      : codingAgentContextOf(
          held.value,
          contextWindowOf(offered, held.value.model, held.value.contextWindow),
        ),
  );

/**
 * When each turn whose journal is among the rows began, by the turn: its
 * start, or its queueing before eve started it, which is what the working
 * line counted from while it ran (`codingAgentRunStartedAt`).
 */
const turnStartsOf = (userId: string, records: readonly StoredMessageRecord[]) => {
  const journals = records.filter((record) => record.message.role === MESSAGE_ROLE.ASSISTANT);
  const ids = new Set(journals.flatMap((record) => record.turnId ?? []));
  return Effect.map(
    turnsNamed(userId, [...ids]),
    (turns) => new Map(turns.map((turn) => [turn.id, (turn.startedAt ?? turn.queuedAt).getTime()])),
  );
};

/** A row as the page carries it: its message, and for a turn's journal when the turn began and, once the journal closed, when. */
function transcriptMessageOf(
  record: StoredMessageRecord,
  turnStarts: ReadonlyMap<string, number>,
): TranscriptMessage {
  const startedAt = record.turnId === undefined ? undefined : turnStarts.get(record.turnId);
  if (startedAt === undefined) return record.message;
  return {
    ...record.message,
    startedAt,
    ...(record.finishedAt === undefined ? undefined : { finishedAt: record.finishedAt.getTime() }),
  };
}

/**
 * The delegations the agent's newest turn still waits on, each with when
 * its worker began: the delegation calls its journal holds unanswered, by
 * the child conversation each recorded. Note that a worker runs only inside
 * the turn that called it, so no older journal is read, and a call whose
 * record has not landed yet is left out until a later page finds it.
 */
const delegationsUnderWay = (
  target: ConversationTarget,
  tools: ToolSet,
  turn: NewestTurn,
): TranscriptEffect<readonly CodingAgentDelegationStart[]> =>
  Effect.gen(function* () {
    if (turn === undefined) return [];
    const read = yield* readMessageByClientId(target.userId, target.conversationId, tools, turn.id);
    const parts = read.ok ? (read.value[0]?.message.parts ?? []) : [];
    const calls = parts
      .filter(isStoredToolPart)
      .filter(
        (part) =>
          storedToolName(part) === CODING_AGENT_DELEGATE_TOOL &&
          !isSettledToolPartState(part.state),
      )
      .map((part) => part.toolCallId);
    const children = calls.map((callId) => ({
      callId,
      child: childConversationId(target.conversationId, callId),
    }));
    const started = yield* delegationStartsOf(
      target,
      children.map((each) => each.child),
    );
    return children.flatMap(({ callId, child }) => {
      const at = started.get(child);
      return at === undefined ? [] : [{ callId, startedAt: at.getTime() }];
    });
  });

/**
 * The page with what the agent has cost: every settled turn of its
 * conversation and its workers', and its newest turn, priced at the catalog
 * as the instance holds it now; a catalog it cannot read prices nothing,
 * so the tokens are told alone. On the agent's own transcript, with what
 * its model's context holds, against the window the same catalog lists,
 * and every title its workers have so far, which land beside their starts
 * and so on no page of their own.
 */
const withUsage = (
  target: ConversationTarget,
  tools: ToolSet,
  page: TranscriptPage,
  turn: NewestTurn,
  own: OwnAgent | undefined,
): TranscriptEffect<TranscriptPage, ModelCatalog> =>
  Effect.gen(function* () {
    const rows = yield* turnUsagesOf(target.userId, target.conversationId);
    const catalog = yield* ModelCatalog;
    const offered = yield* catalog.read.pipe(Effect.orElseSucceed(() => []));
    const usage = usageOfTurns(rows, offered);
    const turnUsage = usageOfTurn(turn, offered);
    const context = own === undefined ? undefined : yield* contextOf(target, own, offered);
    const delegations =
      own !== undefined && WAITING_STATUSES.has(page.status)
        ? yield* delegationsUnderWay(target, tools, turn)
        : [];
    const subagentTitles = own === undefined ? [] : yield* delegationTitlesOf(target);
    return {
      ...page,
      ...(usage === undefined ? undefined : { usage }),
      ...(turnUsage === undefined ? undefined : { turnUsage }),
      ...(context === undefined ? undefined : { context }),
      ...(delegations.length === 0 ? undefined : { delegations }),
      ...(subagentTitles.length === 0 ? undefined : { subagentTitles }),
    };
  });

/** One read of the page past the cursor with the status beside it; a page the vocabulary refuses answers no messages, since nothing readable stands past the cursor. */
function pagePast(
  target: ConversationTarget,
  tools: ToolSet,
  after: MessageCursor,
  createdAt: Date,
): TranscriptEffect<{ readonly page: TranscriptPage; readonly turn: NewestTurn }> {
  return Effect.gen(function* () {
    const { read, cursor } = yield* listMessagesPast(
      target.userId,
      target.conversationId,
      tools,
      after,
      CODING_AGENT_BOUNDS.MESSAGES_PAGE,
    );
    const { status, runStartedAt, failureReason, turn } = yield* statusNow(target, createdAt);
    const records = read.ok ? read.value : [];
    const turnStarts = yield* turnStartsOf(target.userId, records);
    return {
      page: {
        messages: records.map((record) => transcriptMessageOf(record, turnStarts)),
        cursor,
        status,
        ...(runStartedAt === undefined ? undefined : { runStartedAt }),
        ...(failureReason === undefined ? undefined : { failureReason }),
      },
      turn,
    };
  });
}

/** What a wait for a delegation's record answers: the record, or none, with whether the agent it was asked of still runs. */
export type DelegationPast =
  | { readonly delegation: CodingAgentDelegation }
  | { readonly delegation: undefined; readonly agentRuns: boolean };

/**
 * The delegation a call recorded, waited for. A worker's tab opens from
 * the moment its call is requested, which is a step ahead of the record the
 * call's own step writes, so a read that finds none while the agent still
 * runs holds as a transcript read does, on the same poll and bound, and
 * answers the record once it lands; none past the hold says the agent still
 * runs, and none once the agent has ended is none for good.
 */
export function delegationPast(
  parent: ConversationTarget,
  childConversationId: string,
  agent: Pick<AgentStanding, "createdAt">,
): TranscriptEffect<DelegationPast> {
  const once: TranscriptEffect<Option.Option<DelegationPast>> = Effect.gen(function* () {
    const found = yield* readDelegation(parent, childConversationId);
    if (Option.isSome(found)) return Option.some({ delegation: found.value });
    const { status } = yield* statusNow(parent, agent.createdAt);
    return WAITING_STATUSES.has(status)
      ? Option.none()
      : Option.some({ delegation: undefined, agentRuns: false });
  });
  return once.pipe(
    Effect.repeat({ schedule: Schedule.spaced(CODER.MESSAGES_POLL), until: Option.isSome }),
    Effect.timeoutOption(CODER.MESSAGES_HOLD),
    Effect.map((held) =>
      Option.getOrElse(
        Option.flatten(held),
        (): DelegationPast => ({ delegation: undefined, agentRuns: true }),
      ),
    ),
  );
}

/** Whether a held read waits on a title, the agent's own or a worker's, asked at each look inside the hold. */
export type TitleAwaited = TranscriptEffect<boolean>;

/** A read that waits on no title: one whose deployment generates none. */
export const NO_TITLE_AWAITED: TitleAwaited = Effect.succeed(false);

/** Whether the agent's own title may still land: the agent untitled, and its newest turn completed inside the title call's bound, which is when that call is made. */
function ownTitleMayLand(target: ConversationTarget, since: Date): TranscriptEffect<boolean> {
  return Effect.gen(function* () {
    const own = yield* readCodingAgentOfConversation(target.userId, target.conversationId);
    if (Option.isNone(own) || own.value.title !== null) return false;
    const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
    const newest = turns.get(target.conversationId);
    return (
      newest?.status === TURN_STATUS.SETTLED &&
      newest.settledAt !== null &&
      newest.settledAt >= since
    );
  });
}

/**
 * Whether a title may still land: the one worker named, or, where none is,
 * any of the parent's or the agent's own, each still untitled and its call
 * made inside the call's own bound, past which the call that would fill it
 * has given up. A worker's call is made as it is delegated, the agent's as
 * a turn of its completes.
 */
export function titleMayLand(
  parent: ConversationTarget,
  childConversationId?: string,
): TitleAwaited {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const since = new Date(now - Duration.toMillis(CODER.TITLE_TIMEOUT));
    const untitled = yield* untitledDelegationsSince(parent, since);
    if (childConversationId !== undefined) return untitled.has(childConversationId);
    return untitled.size > 0 || (yield* ownTitleMayLand(parent, since));
  });
}

/**
 * The transcript past the cursor: the page as it stands, or, while the
 * agent is starting or runs and nothing new stands yet, the first page with
 * something on it inside the hold, or the empty page and the cursor to
 * read on from once the hold is out. Note that the status on a page that
 * ends the hold is read with that page, so a hold that ran out on an agent
 * that ended meanwhile still says so. The agent's own transcript names the
 * agent as `own`, whose context its pages carry; a worker's names none.
 * An ended agent's empty page is held too while `titleAwaited` says a
 * title may still land, because a reader stops at that page and the
 * agent's own title, or a short worker's, lands after its turn ended; the
 * page that ends that hold carries the title.
 */
export function transcriptPast(
  target: ConversationTarget,
  tools: ToolSet,
  after: MessageCursor,
  agent: Pick<AgentStanding, "createdAt">,
  own?: OwnAgent,
  titleAwaited: TitleAwaited = NO_TITLE_AWAITED,
): TranscriptEffect<TranscriptPage, ModelCatalog> {
  const once = Effect.gen(function* () {
    const read = yield* pagePast(target, tools, after, agent.createdAt);
    if (read.page.messages.length > 0) return Option.some(read);
    if (WAITING_STATUSES.has(read.page.status)) return Option.none();
    return (yield* titleAwaited) ? Option.none() : Option.some(read);
  });
  return once.pipe(
    Effect.repeat({ schedule: Schedule.spaced(CODER.MESSAGES_POLL), until: Option.isSome }),
    Effect.timeoutOption(CODER.MESSAGES_HOLD),
    Effect.flatMap((held) => {
      const read = Option.flatten(held);
      return Option.isSome(read)
        ? Effect.succeed(read.value)
        : pagePast(target, tools, after, agent.createdAt);
    }),
    Effect.flatMap(({ page, turn }) => withUsage(target, tools, page, turn, own)),
  );
}
