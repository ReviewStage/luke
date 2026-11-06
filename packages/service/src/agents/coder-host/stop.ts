import type { DatabaseServices } from "@repo/database/core/query";
import { agentOwnerFactsOf } from "@repo/database/models/agent-owners";
import { pauseAgentQueue } from "@repo/database/models/agent-queue-store";
import {
  type Agent,
  type AgentLatestTurn,
  type AgentStartedFromIt,
  awaitingLinesOfReached,
  continuationsOf,
  latestTurnsOfReached,
  nativeRuntimesOfReached,
  RUNNING_TURN_STATUSES,
} from "@repo/database/models/agent-store";
import { replaceAgentWakeups } from "@repo/database/models/agent-wakeups";
import { devicesNamed } from "@repo/database/models/device-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import type { TaskStandingAgent } from "@repo/database/models/task-store";
import { readAccountNames } from "@repo/database/models/workspace-store";
import type { StoreWriter } from "@repo/database/models/writer";
import { QUEUE_PAUSE } from "@repo/features/agent-queue-wire";
import { AGENT_STATUS, type AgentStatus, type AgentSummary } from "@repo/features/agent-wire";
import { Clock, DateTime, Effect, Exit, Result } from "effect";
import type { HttpClient } from "effect/http";
import { recordServerEvent, SERVER_EVENT } from "../../events/server-events.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { admitsPlanWriter } from "../agent-reach.js";
import {
  type AgentSessions,
  describeUnreachable,
  EVE_CANCEL_OUTCOME,
} from "../eve-host/eve-sessions.js";
import { failedCallRefusal, routedSessions } from "./runtime-sessions.js";
import {
  type AgentTurnStanding,
  agentStatusOf,
  agentSummary,
  lineAwaitsTurn,
  startedBlank,
  summaryAccounts,
  summaryDevices,
} from "./status.js";

export const standingsOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  conversationIds: readonly string[],
): Effect.fn.Return<
  (conversationId: string) => AgentTurnStanding,
  HostedRefusal,
  DatabaseServices
> {
  const turns = yield* hostedStoreOrUnavailable(latestTurnsOfReached(conversationIds));
  const awaiting = yield* hostedStoreOrUnavailable(awaitingLinesOfReached(conversationIds));
  const runtimes = yield* hostedStoreOrUnavailable(nativeRuntimesOfReached(conversationIds));
  return (conversationId) => ({
    turn: turns.get(conversationId),
    awaitingLineAt: awaiting.get(conversationId),
    runtime: runtimes.get(conversationId),
  });
});

export const continuedByOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agentIds: readonly string[],
): Effect.fn.Return<
  (agentId: string) => readonly AgentStartedFromIt[],
  HostedRefusal,
  DatabaseServices
> {
  const continued = yield* hostedStoreOrUnavailable(continuationsOf(userId, agentIds));
  return (agentId) => continued.get(agentId) ?? [];
});

export const summaryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
): Effect.fn.Return<AgentSummary, HostedRefusal, DatabaseServices> {
  const standing = yield* standingsOf([agent.conversationId]);
  const names = yield* hostedStoreOrUnavailable(readAccountNames(summaryAccounts(agent)));
  const continuedBy = yield* continuedByOf(userId, [agent.id]);
  const macs = yield* hostedStoreOrUnavailable(devicesNamed(summaryDevices([agent])));
  const owners = yield* hostedStoreOrUnavailable(agentOwnerFactsOf([agent]));
  return agentSummary(
    agent,
    standing(agent.conversationId),
    yield* Clock.currentTimeMillis,
    names,
    owners,
    continuedBy(agent.id),
    macs,
  );
});

export const statusOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Agent,
): Effect.fn.Return<AgentSummary["status"], HostedRefusal, DatabaseServices> {
  const { turn, awaitingLineAt } = (yield* standingsOf([agent.conversationId]))(
    agent.conversationId,
  );
  return agentStatusOf(turn, {
    createdAt: agent.createdAt,
    now: yield* Clock.currentTimeMillis,
    awaitingLineAt,
    blank: startedBlank(agent),
  });
});

function stoppable(turn: AgentLatestTurn | undefined): turn is AgentLatestTurn & {
  readonly eveTurnId: string;
} {
  return (
    turn !== undefined &&
    RUNNING_TURN_STATUSES.has(turn.status) &&
    turn.eveTurnId !== null &&
    turn.cancelRequestedAt === null
  );
}

export interface TurnStop {
  readonly key?: string;
  readonly by?: string;
}

export const stoppedTurn = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  agent: Agent,
  stop: TurnStop = {},
): Effect.fn.Return<boolean, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  yield* admitsPlanWriter(account, agent);
  return yield* canceledTurn(routedSessions(account), writer, agent, stop);
});

export const stoppedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  agent: Agent,
  stop: TurnStop = {},
): Effect.fn.Return<boolean, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  const stopped = yield* stoppedTurn(writer, account, agent, stop);
  if (stopped) {
    yield* recordServerEvent(
      SERVER_EVENT.AGENT_STOP,
      { userId: account, workspaceId: agent.organizationId },
      { agent_kind: agent.kind },
    );
  }
  return stopped;
});

export const canceledTurn = /* @__PURE__ */ Effect.fnUntraced(function* (
  eveOf: Effect.Effect<
    Pick<AgentSessions, "cancel">,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  writer: Effect.Effect<StoreWriter>,
  agent: Agent,
  { key, by }: TurnStop = {},
): Effect.fn.Return<boolean, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  yield* hostedStoreOrUnavailable(replaceAgentWakeups(agent.id, []));
  yield* hostedStoreOrUnavailable(pauseAgentQueue(agent.id, QUEUE_PAUSE.STOPPED));
  const turn = (yield* standingsOf([agent.conversationId]))(agent.conversationId).turn;
  if (!stoppable(turn)) return false;
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return false;
  const eve = yield* eveOf;
  const canceled = yield* eve
    .cancel(sessionId, turn.eveTurnId)
    .pipe(
      Effect.catchTag("EveUnreachable", (failure) =>
        Effect.as(
          Effect.logWarning(
            `eve could not be reached to stop a coding agent: ${describeUnreachable(failure)}`,
          ),
          { outcome: EVE_CANCEL_OUTCOME.FAILED, status: HOSTED_HTTP_STATUS.BAD_GATEWAY } as const,
        ),
      ),
    );
  if (canceled.outcome === EVE_CANCEL_OUTCOME.FAILED) {
    return yield* Effect.fail(failedCallRefusal(canceled));
  }
  const accepted = canceled.outcome === EVE_CANCEL_OUTCOME.ACCEPTED;
  const at = yield* DateTime.nowAsDate;
  const stamped = yield* hostedStoreOrUnavailable(
    Effect.flatMap(writer, (write) =>
      write.requestTurnCancel(target, {
        turnId: turn.id,
        at,
        ...(key === undefined || !accepted ? undefined : { key }),
        ...(by === undefined ? undefined : { by }),
      }),
    ),
  );
  if (Result.isFailure(stamped)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return accepted;
});

export const stoppedForGood = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  agent: Agent,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  yield* stoppedTurn(writer, account, agent);
  const status = yield* statusOf(agent);
  if (status === AGENT_STATUS.STARTING || status === AGENT_STATUS.RUNNING) {
    return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  }
});

const AGENT_STOP_CONCURRENCY = 3;

export const everyStoppedForGood = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  agents: readonly Agent[],
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  const stops = yield* Effect.forEach(
    agents,
    (agent) => Effect.exit(stoppedForGood(writer, account, agent)),
    { concurrency: AGENT_STOP_CONCURRENCY },
  );
  const refused = stops.find(Exit.isFailure);
  if (refused !== undefined) return yield* refused;
});

export const everyStopsForGood = /* @__PURE__ */ Effect.fnUntraced(function* (
  agents: readonly Agent[],
) {
  const ready = yield* Effect.forEach(agents, stopsForGood, {
    concurrency: AGENT_STOP_CONCURRENCY,
  });
  return !ready.includes(false);
});

export const stopsForGood = /* @__PURE__ */ Effect.fnUntraced(function* (agent: Agent) {
  const { turn, awaitingLineAt } = (yield* standingsOf([agent.conversationId]))(
    agent.conversationId,
  );
  const standing = {
    createdAt: agent.createdAt,
    now: yield* Clock.currentTimeMillis,
    awaitingLineAt,
    blank: startedBlank(agent),
  };
  if (lineAwaitsTurn(turn, standing)) return false;
  const status = agentStatusOf(turn, standing);
  if (status === AGENT_STATUS.STARTING) return false;
  return status !== AGENT_STATUS.RUNNING || stoppable(turn);
});

const standingTurns = /* @__PURE__ */ Effect.fnUntraced(function* (
  agents: readonly TaskStandingAgent[],
) {
  const conversationIds = agents.map(({ conversationId }) => conversationId);
  const turns = yield* latestTurnsOfReached(conversationIds);
  const awaiting = yield* awaitingLinesOfReached(conversationIds);
  const now = yield* Clock.currentTimeMillis;
  return agents.map((agent) => {
    const turn = turns.get(agent.conversationId);
    const status = agentStatusOf(turn, {
      createdAt: agent.createdAt,
      now,
      awaitingLineAt: awaiting.get(agent.conversationId),
      blank: agent.blank,
    });
    return { agent, turn, status };
  });
});

const settledStatus = (status: AgentStatus) =>
  status !== AGENT_STATUS.STARTING && status !== AGENT_STATUS.RUNNING;

export const standsStopped = (agents: readonly TaskStandingAgent[]) =>
  Effect.map(standingTurns(agents), (read) => read.every(({ status }) => settledStatus(status)));

export const standsFinishedWell = (agents: readonly TaskStandingAgent[]) =>
  Effect.map(standingTurns(agents), (read) =>
    read.every(({ status }) => status === AGENT_STATUS.COMPLETED),
  );

export const idleStandingAgents = (agents: readonly TaskStandingAgent[]) =>
  Effect.map(
    standingTurns(agents),
    (read): ReadonlySet<string> =>
      new Set(
        read
          .filter(
            ({ turn, status }) =>
              settledStatus(status) &&
              (turn === undefined || !RUNNING_TURN_STATUSES.has(turn.status)),
          )
          .map(({ agent }) => agent.id),
      ),
  );
