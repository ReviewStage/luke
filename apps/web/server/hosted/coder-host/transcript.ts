import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
  type CodingAgentContext,
  type CodingAgentFailure,
  type CodingAgentStatus,
  type CodingAgentUsage,
} from "@sidecar/hosted/coding-agent-wire";
import type { ToolSet } from "ai";
import { Clock, Effect, Option, Schedule, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { StoredUIMessage } from "../../core.js";
import {
  awaitingLinesOf,
  type CodingAgent,
  type CodingAgentDelegation,
  latestTurnsOf,
  readCodingAgentContext,
  readDelegation,
  turnUsagesOf,
} from "../coding-agent-store.js";
import { ModelCatalog, type OfferedModel } from "../model-catalog.js";
import { type ConversationTarget, listMessagesPast, type MessageCursor } from "../store/index.js";
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
 * its model's context holds as its newest step left it (`context.ts`).
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

/** A page of the transcript as the route answers it: each row's message as the store holds it, which is the wire's `CodingAgentMessage` once serialized, the agent's status as it stood, and why where its newest turn failed. */
export interface TranscriptPage {
  readonly messages: readonly StoredUIMessage[];
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
}

type TranscriptEffect<A, R = never> = Effect.Effect<
  A,
  SqlError | Schema.SchemaError,
  SqlClient.SqlClient | R
>;

/** The newest turn as a page reads it: what it ran under and cost; nothing before the first. */
type NewestTurn = Parameters<typeof usageOfTurn>[0];

/** The agent whose own transcript a page is, as its context is read: its row, and the model it runs on now. */
type OwnAgent = Pick<CodingAgent, "id" | "model">;

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

/** The agent's context as its row holds it, against the window the catalog lists for the model it runs on now; nothing before its first step. */
const contextOf = (target: ConversationTarget, own: OwnAgent, offered: readonly OfferedModel[]) =>
  Effect.map(readCodingAgentContext(target.userId, own.id), (held) =>
    Option.isNone(held)
      ? undefined
      : codingAgentContextOf(held.value, contextWindowOf(offered, own.model)),
  );

/**
 * The page with what the agent has cost: every settled turn of its
 * conversation and its workers', and its newest turn, priced at the catalog
 * as the instance holds it now; a catalog it cannot read prices nothing,
 * so the tokens are told alone. On the agent's own transcript, with what
 * its model's context holds, against the window the same catalog lists.
 */
const withUsage = (
  target: ConversationTarget,
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
    return {
      ...page,
      ...(usage === undefined ? undefined : { usage }),
      ...(turnUsage === undefined ? undefined : { turnUsage }),
      ...(context === undefined ? undefined : { context }),
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
    return {
      page: {
        messages: read.ok ? read.value.map((record) => record.message) : [],
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

/**
 * The transcript past the cursor: the page as it stands, or, while the
 * agent is starting or runs and nothing new stands yet, the first page with
 * something on it inside the hold, or the empty page and the cursor to
 * read on from once the hold is out. Note that the status on a page that
 * ends the hold is read with that page, so a hold that ran out on an agent
 * that ended meanwhile still says so. The agent's own transcript names the
 * agent as `own`, whose context its pages carry; a worker's names none.
 */
export function transcriptPast(
  target: ConversationTarget,
  tools: ToolSet,
  after: MessageCursor,
  agent: Pick<AgentStanding, "createdAt">,
  own?: OwnAgent,
): TranscriptEffect<TranscriptPage, ModelCatalog> {
  const once = Effect.gen(function* () {
    const read = yield* pagePast(target, tools, after, agent.createdAt);
    if (read.page.messages.length > 0) return Option.some(read);
    return WAITING_STATUSES.has(read.page.status) ? Option.none() : Option.some(read);
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
    Effect.flatMap(({ page, turn }) => withUsage(target, page, turn, own)),
  );
}
