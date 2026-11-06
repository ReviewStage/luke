import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import {
  type Agent,
  type AgentDelegation,
  type AgentRouting,
  awaitingLinesOf,
  delegationStartsOf,
  delegationsOf,
  delegationTitlesOf,
  type LinePlace,
  type LineSent,
  latestTurnsOf,
  linePlacesOf,
  lineSendersOf,
  readAgentContext,
  readAgentHeaderOfConversation,
  readAgentRouting,
  readDelegation,
  turnUsagesOf,
  untitledDelegationsSince,
} from "@repo/database/models/agent-store";
import { latestDeviceAgentLaunch } from "@repo/database/models/device-agent-store";
import { childConversationId } from "@repo/database/models/ids";
import {
  type LatestTurn,
  listMessagesBefore,
  listMessagesPast,
  type MessageCursor,
  type MessageListRead,
  messageCursorNow,
  readMessageByClientId,
  type StoredMessageRecord,
  turnsBefore,
  turnsNamed,
} from "@repo/database/models/message-reads";
import type { ConversationTarget } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import type { AgentQueue } from "@repo/features/agent-queue-wire";
import {
  AGENT_BOUNDS,
  AGENT_CURSOR_START,
  AGENT_DELEGATE_TOOL,
  AGENT_LAUNCH,
  AGENT_MACHINE,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentContext,
  type AgentDelegationStart,
  type AgentFailure,
  type AgentLaunch,
  type AgentPayer,
  type AgentSender,
  type AgentStatus,
  type AgentSubagentStanding,
  type AgentSubagentTitle,
  type AgentUsage,
  type TurnRecord,
} from "@repo/features/agent-wire";
import { DEVICE_LAUNCH_STEPS, type DeviceLaunchUnstarted } from "@repo/features/device-agent-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { turnRecordOf } from "@repo/features/turn-record";
import type { ToolSet } from "ai";
import { Clock, Duration, Effect, Option, type Schema } from "effect";
import {
  isSettledToolPartState,
  isStoredToolPart,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type StoredUIMessage,
  storedToolName,
  TURN_STATUS,
} from "../../core.js";
import { heldUntil } from "../../http/held-read.js";
import { ModelCatalog, type OfferedModel } from "../../providers/model-catalog.js";
import { queueOnPage } from "./agent-queue.js";
import { CODER } from "./bounds.js";
import { agentContextOf, contextWindowOf } from "./context.js";
import {
  type AgentStanding,
  agentFailureOf,
  agentRunStartedAt,
  agentStatusOf,
  hostLostOf,
  launchStoppedOf,
  launchUnstartedOf,
  statusClockEdge,
} from "./status.js";
import { usageOfTurns } from "./usage.js";

const CURSOR_SEPARATOR = ":";

export function cursorOfWire(after: string): MessageCursor {
  const [seq, revision] = after.split(CURSOR_SEPARATOR);
  return { seq: Number(seq ?? 0), revision: Number(revision ?? 0) };
}

export function cursorToWire(cursor: MessageCursor): string {
  return `${cursor.seq}${CURSOR_SEPARATOR}${cursor.revision}`;
}

export const CURSOR_START: MessageCursor = cursorOfWire(AGENT_CURSOR_START);

type TranscriptMessage = StoredUIMessage &
  TurnRecord & {
    readonly startedAt?: number;
    readonly finishedAt?: number;
    readonly clientId?: string;
    readonly sentBy?: AgentSender;
    readonly sentAt?: number;
    readonly arrivedIn?: LinePlace;
  };

export interface TranscriptPage {
  readonly messages: readonly TranscriptMessage[];
  readonly cursor: MessageCursor;
  readonly status: AgentStatus;
  readonly runStartedAt?: number;
  readonly failureReason?: AgentFailure;
  readonly hostLost?: { readonly host: string };
  readonly usage?: AgentUsage;
  readonly payer?: AgentPayer;
  readonly context?: AgentContext;
  readonly delegations?: readonly AgentDelegationStart[];
  readonly subagentTitles?: readonly AgentSubagentTitle[];
  readonly subagents?: readonly AgentSubagentStanding[];
  readonly queue?: AgentQueue;
  readonly launch?: AgentLaunch;
  readonly launchUnstarted?: DeviceLaunchUnstarted;
}

type TranscriptEffect<A, R = never> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices | R
>;

type NewestTurn = LatestTurn | undefined;

type OwnAgent = Pick<Agent, "id" | "machine">;

const WAITING_STATUSES: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

type AgentStart = Pick<AgentStanding, "createdAt" | "blank">;

const statusNow = (target: ConversationTarget, { createdAt, blank }: AgentStart) =>
  Effect.gen(function* () {
    const { turns, awaiting } = yield* Effect.all(
      {
        turns: latestTurnsOf(target.userId, [target.conversationId]),
        awaiting: awaitingLinesOf(target.userId, [target.conversationId]),
      },
      { concurrency: CODER.READ_CONCURRENCY },
    );
    const now = yield* Clock.currentTimeMillis;
    const turn = turns.get(target.conversationId);
    const awaitingLineAt = awaiting.get(target.conversationId);
    const status = agentStatusOf(turn, { createdAt, now, awaitingLineAt, blank });
    const runStartedAt = agentRunStartedAt(turn, { createdAt, now, awaitingLineAt });
    const failed = status === AGENT_STATUS.FAILED;
    const failureReason = failed ? agentFailureOf(turn) : undefined;
    const hostLost = failed ? hostLostOf(turn) : undefined;
    const graceEdge = statusClockEdge(turn, { createdAt, now, awaitingLineAt, blank });
    return { status, runStartedAt, failureReason, hostLost, turn, graceEdge };
  });

const launchOf = (
  target: ConversationTarget,
  own: OwnAgent | undefined,
  turn: NewestTurn,
  status: AgentStatus,
): TranscriptEffect<AgentLaunch | undefined> => {
  if (own?.machine === AGENT_MACHINE.DEVICE && status === AGENT_STATUS.FAILED) {
    return Effect.succeed(launchStoppedOf(turn));
  }
  if (own?.machine !== AGENT_MACHINE.DEVICE || !WAITING_STATUSES.has(status)) {
    return Effect.succeed(undefined);
  }
  return Effect.map(latestDeviceAgentLaunch(target.userId, own.id), (newest) => {
    if (Option.isNone(newest)) return undefined;
    const { createdAt, claimed, step, settled, stopped } = newest.value;
    const opened = turn !== undefined && turn.queuedAt >= createdAt;
    if (settled || stopped || opened) return undefined;
    if (!claimed) return AGENT_LAUNCH.WAITING;
    return DEVICE_LAUNCH_STEPS.find((known) => known === step);
  });
};

const heldContextOf = (target: ConversationTarget, own: OwnAgent | undefined) =>
  own === undefined
    ? Effect.succeed(Option.none<HeldContext>())
    : readAgentContext(target.userId, own.id);

type HeldContext = Option.Option.Value<Effect.Success<ReturnType<typeof readAgentContext>>>;

const windowListed = (offered: readonly OfferedModel[], modelId: string) => {
  const model = offered.find((each) => each.id === modelId);
  return model?.contextWindow !== undefined || model?.contextWindows !== undefined;
};

const contextOf = (
  held: Option.Option<HeldContext>,
  routing: Option.Option<AgentRouting>,
  offered: readonly OfferedModel[],
) =>
  Option.isNone(held) || Option.isNone(routing) || !windowListed(offered, held.value.model)
    ? undefined
    : agentContextOf(
        held.value,
        contextWindowOf(offered, held.value.model, held.value.contextWindow),
        routing.value.runtime,
      );

interface JournalTurn {
  readonly startedAt: number;
  readonly record: TurnRecord;
}

const journalTurnsOf = (userId: string, records: readonly StoredMessageRecord[]) => {
  const journals = records.filter(
    (record) => record.message.role === MESSAGE_ROLE.ASSISTANT && !spokenOnCall(record.message),
  );
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

const SENDER_NAME = {
  APP: PRODUCT_NAME,
  FORMER_MEMBER: "Former member",
} as const;

function senderOf(sent: LineSent): AgentSender {
  switch (sent.kind) {
    case MESSAGE_SENDER.MEMBER:
      return sent.member === undefined
        ? { name: SENDER_NAME.FORMER_MEMBER, kind: AGENT_SENDER.FORMER }
        : { ...sent.member, kind: AGENT_SENDER.MEMBER };
    case MESSAGE_SENDER.APP:
      return { name: SENDER_NAME.APP, kind: AGENT_SENDER.APP };
    case MESSAGE_SENDER.AUTOMATION:
      return {
        name: sent.name,
        kind: AGENT_SENDER.AUTOMATION,
        ...(sent.automationId === undefined ? undefined : { automationId: sent.automationId }),
      };
    case MESSAGE_SENDER.GITHUB:
      return { name: sent.login, kind: AGENT_SENDER.GITHUB };
    case MESSAGE_SENDER.AGENT:
      return {
        name: sent.name,
        agent: true,
        ...(sent.model === undefined ? undefined : { model: sent.model }),
        ...(sent.agent === undefined ? undefined : { agentId: sent.agent.id }),
      };
  }
}

function lineIdsAmong(records: readonly StoredMessageRecord[]): readonly string[] {
  return records
    .filter((record) => record.message.role === MESSAGE_ROLE.USER)
    .map((record) => record.id);
}

interface LinesRead {
  readonly senders: ReadonlyMap<string, LineSent>;
  readonly places: ReadonlyMap<string, LinePlace>;
}

function spokenOnCall(message: StoredUIMessage): boolean {
  if (message.role === MESSAGE_ROLE.SYSTEM) return false;
  const { metadata } = message;
  return "channel" in metadata && metadata.channel === MESSAGE_CHANNEL.VOICE;
}

function transcriptMessageOf(
  record: StoredMessageRecord,
  journalTurns: ReadonlyMap<string, JournalTurn>,
  { senders, places }: LinesRead,
): TranscriptMessage {
  if (record.message.role === MESSAGE_ROLE.USER) {
    const sent = senders.get(record.id);
    const place = places.get(record.id);
    return {
      ...record.message,
      clientId: record.clientId,
      ...(sent === undefined ? undefined : { sentBy: senderOf(sent) }),
      sentAt: record.placedAt.getTime(),
      ...(place === undefined ? undefined : { arrivedIn: place }),
    };
  }
  if (spokenOnCall(record.message)) {
    return { ...record.message, sentAt: record.placedAt.getTime() };
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

const delegationsUnderWay = (
  target: ConversationTarget,
  tools: ToolSet,
  turn: NewestTurn,
): TranscriptEffect<readonly AgentDelegationStart[]> =>
  Effect.gen(function* () {
    if (turn === undefined) return [];
    const read = yield* readMessageByClientId(target.userId, target.conversationId, tools, turn.id);
    const parts = read.ok ? (read.value[0]?.message.parts ?? []) : [];
    const calls = parts
      .filter(isStoredToolPart)
      .filter(
        (part) =>
          storedToolName(part) === AGENT_DELEGATE_TOOL && !isSettledToolPartState(part.state),
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

const subagentStandingsOf = (
  target: ConversationTarget,
): TranscriptEffect<readonly AgentSubagentStanding[]> =>
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
      status: agentStatusOf(turns.get(each.childConversationId), {
        createdAt: each.createdAt,
        now,
      }),
      model: each.model,
      effort: each.effort,
      startedAt: each.createdAt.getTime(),
    }));
  });

const routingOf = (target: ConversationTarget, own: OwnAgent | undefined) =>
  own === undefined
    ? Effect.succeed(Option.none<AgentRouting>())
    : readAgentRouting(target.userId, own.id);

const withUsage = (
  target: ConversationTarget,
  tools: ToolSet,
  page: TranscriptPage,
  turn: NewestTurn,
  own: OwnAgent | undefined,
): TranscriptEffect<TranscriptPage, ModelCatalog> =>
  Effect.gen(function* () {
    const catalog = yield* ModelCatalog;
    const { rows, offered, routing, held, delegations, subagentTitles, subagents, queue, launch } =
      yield* Effect.all(
        {
          rows: turnUsagesOf(target.userId, target.conversationId),
          offered: catalog.read.pipe(Effect.orElseSucceed((): readonly OfferedModel[] => [])),
          routing: routingOf(target, own),
          held: heldContextOf(target, own),
          delegations:
            own !== undefined && WAITING_STATUSES.has(page.status)
              ? delegationsUnderWay(target, tools, turn)
              : Effect.succeed<readonly AgentDelegationStart[]>([]),
          subagentTitles:
            own === undefined
              ? Effect.succeed<readonly AgentSubagentTitle[]>([])
              : delegationTitlesOf(target),
          subagents:
            own === undefined
              ? Effect.succeed<readonly AgentSubagentStanding[]>([])
              : subagentStandingsOf(target),
          queue: own === undefined ? Effect.succeed(undefined) : queueOnPage(own.id),
          launch: launchOf(target, own, turn, page.status),
        },
        { concurrency: CODER.READ_CONCURRENCY },
      );
    const launchUnstarted =
      launch !== undefined &&
      own?.machine === AGENT_MACHINE.DEVICE &&
      page.status === AGENT_STATUS.FAILED
        ? launchUnstartedOf(turn)
        : undefined;
    const payer = Option.isNone(routing) ? null : routing.value.payer;
    const priced = usageOfTurns(rows, offered);
    const usage = priced === undefined || payer === null ? priced : { ...priced, payer };
    const context = contextOf(held, routing, offered);
    return {
      ...page,
      ...(usage === undefined ? undefined : { usage }),
      ...(payer === null ? undefined : { payer }),
      ...(context === undefined ? undefined : { context }),
      ...(delegations.length === 0 ? undefined : { delegations }),
      ...(subagentTitles.length === 0 ? undefined : { subagentTitles }),
      ...(subagents.length === 0 ? undefined : { subagents }),
      ...(queue === undefined ? undefined : { queue }),
      ...(launch === undefined ? undefined : { launch }),
      ...(launchUnstarted === undefined ? undefined : { launchUnstarted }),
    };
  });

const transcriptMessagesOf = (
  target: ConversationTarget,
  records: readonly StoredMessageRecord[],
): TranscriptEffect<readonly TranscriptMessage[]> =>
  Effect.gen(function* () {
    const lines = lineIdsAmong(records);
    const { journalTurns, ...linesRead } = yield* Effect.all(
      {
        journalTurns: journalTurnsOf(target.userId, records),
        senders: lineSendersOf(target, lines),
        places: linePlacesOf(target, lines),
      },
      { concurrency: CODER.READ_CONCURRENCY },
    );
    return records.map((record) => transcriptMessageOf(record, journalTurns, linesRead));
  });

function pagePast(
  target: ConversationTarget,
  tools: ToolSet,
  after: MessageCursor,
  agent: AgentStart,
): TranscriptEffect<{
  readonly page: TranscriptPage;
  readonly turn: NewestTurn;
  readonly graceEdge: number | undefined;
}> {
  return Effect.gen(function* () {
    const { past, standing } = yield* Effect.all(
      {
        past: listMessagesPast(
          target.userId,
          target.conversationId,
          tools,
          after,
          AGENT_BOUNDS.MESSAGES_PAGE,
        ),
        standing: statusNow(target, agent),
      },
      { concurrency: CODER.READ_CONCURRENCY },
    );
    const { read, cursor } = past;
    const { status, runStartedAt, failureReason, hostLost, turn, graceEdge } = standing;
    return {
      page: {
        messages: yield* transcriptMessagesOf(target, read.ok ? read.value : []),
        cursor,
        status,
        ...(runStartedAt === undefined ? undefined : { runStartedAt }),
        ...(failureReason === undefined ? undefined : { failureReason }),
        ...(hostLost === undefined ? undefined : { hostLost }),
      },
      turn,
      graceEdge,
    };
  });
}

export type DelegationPast =
  | { readonly delegation: AgentDelegation }
  | { readonly delegation: undefined; readonly agentRuns: boolean };

interface DelegationStanding {
  readonly read: DelegationPast;
  readonly graceEdge: number | undefined;
}

function delegationStanding(
  parent: ConversationTarget,
  childConversationId: string,
  agent: Pick<AgentStanding, "createdAt">,
): TranscriptEffect<DelegationStanding> {
  return Effect.gen(function* () {
    const found = yield* readDelegation(parent, childConversationId);
    if (Option.isSome(found)) return { read: { delegation: found.value }, graceEdge: undefined };
    const { status, graceEdge } = yield* statusNow(parent, agent);
    return { read: { delegation: undefined, agentRuns: WAITING_STATUSES.has(status) }, graceEdge };
  });
}

export function delegationNow(
  parent: ConversationTarget,
  childConversationId: string,
  agent: Pick<AgentStanding, "createdAt">,
): TranscriptEffect<DelegationPast> {
  return Effect.map(delegationStanding(parent, childConversationId, agent), ({ read }) => read);
}

export function delegationPast(
  parent: ConversationTarget,
  childConversationId: string,
  agent: Pick<AgentStanding, "createdAt">,
): TranscriptEffect<DelegationPast> {
  return heldUntil(
    delegationStanding(parent, childConversationId, agent),
    ({ read }) => read.delegation !== undefined || !read.agentRuns,
    transcriptTopics(parent),
    CODER.MESSAGES_POLL,
    CODER.MESSAGES_HOLD,
    ({ graceEdge }) => graceEdge,
  ).pipe(
    Effect.map((held) =>
      Option.match(held, {
        onNone: (): DelegationPast => ({ delegation: undefined, agentRuns: true }),
        onSome: ({ read }) => read.read,
      }),
    ),
  );
}

export type TitleAwaited = TranscriptEffect<boolean>;

export const NO_TITLE_AWAITED: TitleAwaited = Effect.succeed(false);

function ownTitleWindow(
  target: ConversationTarget,
  since: Date,
): TranscriptEffect<Option.Option<Date>> {
  return Effect.gen(function* () {
    const own = yield* readAgentHeaderOfConversation(target.userId, target.conversationId);
    if (Option.isNone(own) || own.value.title !== null) return Option.none();
    const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
    const newest = turns.get(target.conversationId);
    const completed =
      newest?.status === TURN_STATUS.SETTLED &&
      newest.settledAt !== null &&
      newest.settledAt >= since;
    if (!completed || newest.settledAt === null) return Option.none();
    const ran = yield* turnsBefore(
      target.userId,
      target.conversationId,
      CODER.TITLE_TURNS,
      undefined,
    );
    return ran.earlier ? Option.none() : Option.some(newest.settledAt);
  });
}

export function titleMayLand(
  parent: ConversationTarget,
  childConversationId?: string,
): TitleAwaited {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const since = new Date(now - Duration.toMillis(CODER.TITLE_TIMEOUT));
    const untitled = yield* untitledDelegationsSince(parent, since);
    if (childConversationId !== undefined) return untitled.has(childConversationId);
    return untitled.size > 0 || Option.isSome(yield* ownTitleWindow(parent, since));
  });
}

export type TitleEdge = TranscriptEffect<number | undefined>;

export const NO_TITLE_EDGE: TitleEdge = Effect.succeed(undefined);

export function titleWindowEdge(
  parent: ConversationTarget,
  childConversationId?: string,
): TitleEdge {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const bound = Duration.toMillis(CODER.TITLE_TIMEOUT);
    const since = new Date(now - bound);
    const untitled = yield* untitledDelegationsSince(parent, since);
    const named = (child: string) =>
      untitled.has(child) && (childConversationId === undefined || child === childConversationId);
    const workers =
      untitled.size === 0
        ? []
        : (yield* delegationsOf(parent)).filter((each) => named(each.childConversationId));
    const own =
      childConversationId === undefined ? yield* ownTitleWindow(parent, since) : Option.none();
    const opened = [...workers.map((each) => each.createdAt), ...Option.toArray(own)];
    if (opened.length === 0) return undefined;
    return Math.max(...opened.map((at) => at.getTime())) + bound + 1;
  });
}

const holdsFor = (page: TranscriptPage, titleAwaited: TitleAwaited): TranscriptEffect<boolean> => {
  if (page.messages.length > 0) return Effect.succeed(false);
  if (WAITING_STATUSES.has(page.status)) return Effect.succeed(true);
  return titleAwaited;
};

const holdEdgeOf = (
  page: TranscriptPage,
  graceEdge: number | undefined,
  titleEdge: TitleEdge,
): TranscriptEffect<number | undefined> =>
  WAITING_STATUSES.has(page.status) ? Effect.succeed(graceEdge) : titleEdge;

function transcriptTopics(target: ConversationTarget, own?: OwnAgent): readonly SyncTopic[] {
  const conversation: SyncTopic = [TOPIC.CONVERSATION, target.conversationId];
  return own === undefined ? [conversation] : [conversation, [TOPIC.AGENT, own.id]];
}

export function transcriptPast(
  target: ConversationTarget,
  tools: ToolSet,
  after: MessageCursor,
  agent: AgentStart,
  own?: OwnAgent,
  titleAwaited: TitleAwaited = NO_TITLE_AWAITED,
  titleEdge: TitleEdge = NO_TITLE_EDGE,
  poll: Duration.Duration = CODER.MESSAGES_POLL,
): TranscriptEffect<TranscriptPage, ModelCatalog> {
  const look = Effect.gen(function* () {
    const read = yield* pagePast(target, tools, after, agent);
    if (!(yield* holdsFor(read.page, titleAwaited))) return { read, holds: false, edge: undefined };
    return { read, holds: true, edge: yield* holdEdgeOf(read.page, read.graceEdge, titleEdge) };
  });
  return heldUntil(
    look,
    ({ holds }) => !holds,
    transcriptTopics(target, own),
    poll,
    CODER.MESSAGES_HOLD,
    ({ edge }) => edge,
  ).pipe(
    Effect.flatMap((held) =>
      Option.isSome(held)
        ? Effect.succeed(held.value.read.read)
        : pagePast(target, tools, after, agent),
    ),
    Effect.flatMap(({ page, turn }) => withUsage(target, tools, page, turn, own)),
  );
}

export interface TranscriptNow {
  readonly page: TranscriptPage;
  readonly holds: boolean;
  readonly wakeIn?: number;
}

export function transcriptNow(
  target: ConversationTarget,
  tools: ToolSet,
  after: MessageCursor,
  agent: AgentStart,
  own?: OwnAgent,
  titleAwaited: TitleAwaited = NO_TITLE_AWAITED,
  titleEdge: TitleEdge = NO_TITLE_EDGE,
): TranscriptEffect<TranscriptNow, ModelCatalog> {
  return Effect.gen(function* () {
    const { page, turn, graceEdge } = yield* pagePast(target, tools, after, agent);
    const holds = yield* holdsFor(page, titleAwaited);
    const read = { page: yield* withUsage(target, tools, page, turn, own), holds };
    if (!holds) return read;
    const edge = yield* holdEdgeOf(page, graceEdge, titleEdge);
    if (edge === undefined) return read;
    const now = yield* Clock.currentTimeMillis;
    return { ...read, wakeIn: Math.max(1, edge - now) };
  });
}

export interface TranscriptOlder {
  readonly messages: readonly TranscriptMessage[];
  readonly before?: number;
}

export interface TranscriptNewest {
  readonly page: TranscriptPage;
  readonly before?: number;
}

const olderPageOf = (
  target: ConversationTarget,
  read: MessageListRead,
): TranscriptEffect<TranscriptOlder> =>
  Effect.gen(function* () {
    if (!read.ok) return { messages: [], before: read.seq };
    const records = read.value;
    const messages = yield* transcriptMessagesOf(target, records);
    const [oldest] = records;
    return records.length < AGENT_BOUNDS.MESSAGES_PAGE || oldest === undefined
      ? { messages }
      : { messages, before: oldest.seq };
  });

export function transcriptNewest(
  target: ConversationTarget,
  tools: ToolSet,
  agent: AgentStart,
  own?: OwnAgent,
): TranscriptEffect<TranscriptNewest, ModelCatalog> {
  return Effect.gen(function* () {
    const cursor = yield* messageCursorNow(target.userId, target.conversationId);
    const { read, standing } = yield* Effect.all(
      {
        read: listMessagesBefore(
          target.userId,
          target.conversationId,
          tools,
          cursor.seq + 1,
          AGENT_BOUNDS.MESSAGES_PAGE,
        ),
        standing: statusNow(target, agent),
      },
      { concurrency: CODER.READ_CONCURRENCY },
    );
    const { messages, before } = yield* olderPageOf(target, read);
    const { status, runStartedAt, failureReason, hostLost, turn } = standing;
    const page: TranscriptPage = {
      messages,
      cursor,
      status,
      ...(runStartedAt === undefined ? undefined : { runStartedAt }),
      ...(failureReason === undefined ? undefined : { failureReason }),
      ...(hostLost === undefined ? undefined : { hostLost }),
    };
    return {
      page: yield* withUsage(target, tools, page, turn, own),
      ...(before === undefined ? undefined : { before }),
    };
  });
}

export function transcriptBefore(
  target: ConversationTarget,
  tools: ToolSet,
  before: number,
): TranscriptEffect<TranscriptOlder> {
  return Effect.flatMap(
    listMessagesBefore(
      target.userId,
      target.conversationId,
      tools,
      before,
      AGENT_BOUNDS.MESSAGES_PAGE,
    ),
    (read) => olderPageOf(target, read),
  );
}
