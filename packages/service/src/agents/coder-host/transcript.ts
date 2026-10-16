import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import {
  awaitingLinesOf,
  type CodingAgent,
  type CodingAgentDelegation,
  delegationStartsOf,
  delegationsOf,
  delegationTitlesOf,
  type LinePlace,
  type LineSent,
  latestTurnsOf,
  linePlacesOf,
  lineSendersOf,
  readCodingAgentContext,
  readCodingAgentOfConversation,
  readDelegation,
  turnUsagesOf,
  untitledDelegationsSince,
} from "@luke/database/models/coding-agent-store";
import { childConversationId } from "@luke/database/models/ids";
import {
  type LatestTurn,
  listMessagesPast,
  type MessageCursor,
  readMessageByClientId,
  type StoredMessageRecord,
  turnsBefore,
  turnsNamed,
} from "@luke/database/models/message-reads";
import type { ConversationTarget } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_DELEGATE_TOOL,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentContext,
  type CodingAgentDelegationStart,
  type CodingAgentFailure,
  type CodingAgentSender,
  type CodingAgentStatus,
  type CodingAgentSubagentStanding,
  type CodingAgentSubagentTitle,
  type CodingAgentUsage,
  type TurnRecord,
} from "@luke/features/coding-agent-wire";
import type { ToolSet } from "ai";
import { Clock, Duration, Effect, Option, Schedule, type Schema } from "effect";
import {
  isSettledToolPartState,
  isStoredToolPart,
  MESSAGE_ROLE,
  type StoredUIMessage,
  storedToolName,
  TURN_STATUS,
} from "../../core.js";
import { ModelCatalog, type OfferedModel } from "../../providers/model-catalog.js";
import { turnRecordOf } from "../turn-record.js";
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
 * when each worker its newest turn still waits on began. A line that
 * steered a turn under way carries the turn's journal and the steps it had
 * begun before the line, since the journal closes behind every line its
 * turn took and the order alone would draw the line ahead of the turn's
 * work. A turn's journal
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

/** One row of the transcript as the route answers it: its message as the store holds it, for a turn's journal when the turn began and closed and what it ran on and spent, and for a developer's line what sent it, which is the wire's `CodingAgentMessage` once serialized. */
type TranscriptMessage = StoredUIMessage &
  TurnRecord & {
    readonly startedAt?: number;
    readonly finishedAt?: number;
    readonly sentBy?: CodingAgentSender;
    readonly arrivedIn?: LinePlace;
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
  /** Where every one of its workers stands, read from the worker's own session, on its own transcript; absent while it has delegated nothing and on a worker's. */
  readonly subagents?: readonly CodingAgentSubagentStanding[];
}

type TranscriptEffect<A, R = never> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices | R
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

/** What a turn whose journal is on a page says of itself: when it began, and what it ran on and spent. */
interface JournalTurn {
  readonly startedAt: number;
  readonly record: TurnRecord;
}

/**
 * Each turn whose journal is among the rows, by the turn: when it began,
 * its start or its queueing before eve started it, which is what the
 * working line counted from while it ran (`codingAgentRunStartedAt`), and
 * what it ran on and spent as its row recorded them (`turn-record.ts`).
 */
const journalTurnsOf = (userId: string, records: readonly StoredMessageRecord[]) => {
  const journals = records.filter((record) => record.message.role === MESSAGE_ROLE.ASSISTANT);
  const ids = new Set(journals.flatMap((record) => record.turnId ?? []));
  return Effect.map(
    turnsNamed(userId, [...ids]),
    (turns) =>
      new Map<string, JournalTurn>(
        turns.map((turn) => [
          turn.id,
          { startedAt: (turn.startedAt ?? turn.queuedAt).getTime(), record: turnRecordOf(turn) },
        ]),
      ),
  );
};

/** The names a line is sent under where no member's account names it: Luke's, and a member's whose account is gone. */
const SENDER_NAME = {
  LUKE: "Luke",
  FORMER_MEMBER: "Former member",
} as const;

/**
 * What sent a line, as the page names it and by its kind, so the window
 * draws Luke, an automation, and GitHub's login as themselves. Another agent
 * is named with no kind and marked `agent`, because the window's schema reads
 * the kind as one of the words it knows, so a kind it was built before would
 * refuse the whole page, while a key it does not know is dropped: an older
 * build draws it as a sender it cannot place, under its name, and a newer
 * one as an agent.
 */
function senderOf(sent: LineSent): CodingAgentSender {
  switch (sent.kind) {
    case MESSAGE_SENDER.MEMBER:
      return sent.member === undefined
        ? { name: SENDER_NAME.FORMER_MEMBER, kind: CODING_AGENT_SENDER.FORMER }
        : { ...sent.member, kind: CODING_AGENT_SENDER.MEMBER };
    case MESSAGE_SENDER.LUKE:
      return { name: SENDER_NAME.LUKE, kind: CODING_AGENT_SENDER.LUKE };
    case MESSAGE_SENDER.AUTOMATION:
      return { name: sent.name, kind: CODING_AGENT_SENDER.AUTOMATION };
    case MESSAGE_SENDER.GITHUB:
      return { name: sent.login, kind: CODING_AGENT_SENDER.GITHUB };
    case MESSAGE_SENDER.AGENT:
      return {
        name: sent.name,
        agent: true,
        ...(sent.model === undefined ? undefined : { model: sent.model }),
      };
  }
}

/** The ids of the developer's lines among the rows. */
function lineIdsAmong(records: readonly StoredMessageRecord[]): readonly string[] {
  return records
    .filter((record) => record.message.role === MESSAGE_ROLE.USER)
    .map((record) => record.id);
}

/** What a page knows of the developer's lines among its rows, by row: what sent each where its row kept it, and where in a turn under way each arrived where one took it in. */
interface LinesRead {
  readonly senders: ReadonlyMap<string, LineSent>;
  readonly places: ReadonlyMap<string, LinePlace>;
}

/** A row as the page carries it: its message, for a developer's line what sent it and where in a turn under way it arrived, and for a turn's journal when the turn began and what it ran on and, once the journal closed, when it did and what it spent. */
function transcriptMessageOf(
  record: StoredMessageRecord,
  journalTurns: ReadonlyMap<string, JournalTurn>,
  { senders, places }: LinesRead,
): TranscriptMessage {
  const sent = senders.get(record.id);
  const place = places.get(record.id);
  if (sent !== undefined || place !== undefined) {
    return {
      ...record.message,
      ...(sent === undefined ? undefined : { sentBy: senderOf(sent) }),
      ...(place === undefined ? undefined : { arrivedIn: place }),
    };
  }
  const turn = record.turnId === undefined ? undefined : journalTurns.get(record.turnId);
  if (turn === undefined) return record.message;
  return {
    ...record.message,
    startedAt: turn.startedAt,
    ...(record.finishedAt === undefined ? undefined : { finishedAt: record.finishedAt.getTime() }),
    ...turn.record,
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
 * Where every worker of the agent's stands: the status its own session's
 * newest turn reads as, as an agent's own does (`status.ts`), with a worker
 * whose session has opened no turn yet starting within the grace and failed
 * past it, the pair its delegation recorded, and when it began. Note that
 * the worker's session is read rather than the call that started it, because
 * a call may settle the moment its worker is under way.
 */
const subagentStandingsOf = (
  target: ConversationTarget,
): TranscriptEffect<readonly CodingAgentSubagentStanding[]> =>
  Effect.gen(function* () {
    const delegations = yield* delegationsOf(target);
    if (delegations.length === 0) return [];
    const turns = yield* latestTurnsOf(
      target.userId,
      delegations.map((each) => each.childConversationId),
    );
    const now = yield* Clock.currentTimeMillis;
    return delegations.map((each) => ({
      callId: each.callId,
      status: codingAgentStatusOf(turns.get(each.childConversationId), {
        createdAt: each.createdAt,
        now,
      }),
      model: each.model,
      effort: each.effort,
      startedAt: each.createdAt.getTime(),
    }));
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
    const subagents = own === undefined ? [] : yield* subagentStandingsOf(target);
    return {
      ...page,
      ...(usage === undefined ? undefined : { usage }),
      ...(turnUsage === undefined ? undefined : { turnUsage }),
      ...(context === undefined ? undefined : { context }),
      ...(delegations.length === 0 ? undefined : { delegations }),
      ...(subagentTitles.length === 0 ? undefined : { subagentTitles }),
      ...(subagents.length === 0 ? undefined : { subagents }),
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
    const journalTurns = yield* journalTurnsOf(target.userId, records);
    const lines = lineIdsAmong(records);
    const linesRead: LinesRead = {
      senders: yield* lineSendersOf(target, lines),
      places: yield* linePlacesOf(target, lines),
    };
    return {
      page: {
        messages: records.map((record) => transcriptMessageOf(record, journalTurns, linesRead)),
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

/** Whether the agent's own title may still land: the agent untitled, its newest turn one of the turns it is titled in, and that turn completed inside the title call's bound, which is when that call is made. */
function ownTitleMayLand(target: ConversationTarget, since: Date): TranscriptEffect<boolean> {
  return Effect.gen(function* () {
    const own = yield* readCodingAgentOfConversation(target.userId, target.conversationId);
    if (Option.isNone(own) || own.value.title !== null) return false;
    const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
    const newest = turns.get(target.conversationId);
    const completed =
      newest?.status === TURN_STATUS.SETTLED &&
      newest.settledAt !== null &&
      newest.settledAt >= since;
    if (!completed) return false;
    const ran = yield* turnsBefore(
      target.userId,
      target.conversationId,
      CODER.TITLE_TURNS,
      undefined,
    );
    return !ran.earlier;
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
 * A planning worker's looks again on the voice's own beat (`poll`).
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
  poll: Duration.Input = CODER.MESSAGES_POLL,
): TranscriptEffect<TranscriptPage, ModelCatalog> {
  const once = Effect.gen(function* () {
    const read = yield* pagePast(target, tools, after, agent.createdAt);
    if (read.page.messages.length > 0) return Option.some(read);
    if (WAITING_STATUSES.has(read.page.status)) return Option.none();
    return (yield* titleAwaited) ? Option.none() : Option.some(read);
  });
  return once.pipe(
    Effect.repeat({ schedule: Schedule.spaced(poll), until: Option.isSome }),
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
