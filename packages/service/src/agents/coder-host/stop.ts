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
  SESSION_CANCEL_OUTCOME,
} from "../sessions/agent-sessions.js";
import { failedCallRefusal, routedSessions, sessionsRouter } from "./runtime-sessions.js";
import {
  type AgentTurnStanding,
  agentStatusOf,
  agentSummary,
  lineAwaitsTurn,
  startedBlank,
  summaryAccounts,
  summaryDevices,
} from "./status.js";

/**
 * stop.ts -- the one Stop: the harness's cancel of a coding agent's turn under way, then the row's stamp.
 *
 * A Stop pressed on the agent, its archive, and the archive or the delete of
 * the task it works on all stop it here, reaching the agent's sessions for
 * the account the request resolved to (`routedSessions`); a continue of the agent stops it here too,
 * over the sessions its Start reached (`start.ts`), and an agent's `stop_agent`
 * stops one as the deployment acting for the member the caller acts for
 * (`../agent-tools.ts`). The cancel names the turn the row was
 * written for, so a turn that ended meanwhile is not followed by a newer
 * one stopped in its place, and a harness that refuses leaves the row as it
 * stood and the caller unavailable. An agent stopped for good, as an
 * archive or a delete wants it, must also have no turn coming that no
 * Stop could name yet: a session still coming up, or a line awaiting the
 * turn it opens, is refused as not ready until that turn exists or has
 * ended. Every agent here was read through the caller's membership of its
 * task's workspace, so a member stops a teammate's agent on the agent's own
 * conversation, whichever of them started it.
 */

/** Where each of the agents' conversations named stands now, read by id since the agents passed the task's gate: its newest turn, and whether a line of the developer's awaits one. */
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

/** The agents started from each of the agents named, as the account reads them, by the id of the agent each was started from. */
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

/** The agent's summary as the account reads it, with its status read now. */
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

/** Where the agent stands now. */
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

/** Whether the turn is one a Stop has something to stop: still running, with the runtime's id to name, and no Stop on it yet. */
function stoppable(turn: AgentLatestTurn | undefined): turn is AgentLatestTurn & {
  readonly runtimeTurnId: string;
} {
  return (
    turn !== undefined &&
    RUNNING_TURN_STATUSES.has(turn.status) &&
    turn.runtimeTurnId !== null &&
    turn.cancelRequestedAt === null
  );
}

/** What made a Stop, written on the turn's row beside its instant (`TurnCancelRequest`): none of it for a member's Stop. */
export interface TurnStop {
  /** The id of the tool call the Stop is made under, where an agent's `stop_agent` made it. */
  readonly key?: string;
  /** The coding agent whose `stop_agent` or continue makes the Stop; none for the developer's or the app's. */
  readonly by?: string;
}

/** The harness's cancel of the agent's turn under way, for the account the request resolved to, then the row's stamp, and whether the harness took it (`canceledTurn`); nothing where no turn runs that a Stop has to stop. */
export const stoppedTurn = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  agent: Agent,
  stop: TurnStop = {},
): Effect.fn.Return<boolean, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  // An agent its starter's plan pays for is stopped by those the plan's policy admits.
  yield* admitsPlanWriter(account, agent);
  return yield* canceledTurn(routedSessions(account), writer, agent, stop);
});

/** A Stop of the agent as every surface makes it, the app's button, `stop_agent`, and the command line alike: `stoppedTurn`, counted under the account where it stopped a turn. */
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

/**
 * The harness's cancel of the agent's turn under way, over the sessions given,
 * then the row's stamp, and whether the harness took the cancel; false where no
 * turn runs that a Stop has to stop, a turn already stamped among them, so a
 * second Stop asks the harness nothing. A turn the harness says ended meanwhile
 * is stamped all the same but answered false, since this Stop stopped nothing.
 * A tool call's key is written beside the stamp only where the harness took the cancel, so the
 * call run again finds the turn it stopped, and one that stopped nothing is
 * run again as it first ran.
 */
export const canceledTurn = /* @__PURE__ */ Effect.fnUntraced(function* (
  agentSessionsOf: Effect.Effect<
    Pick<AgentSessions, "cancel">,
    HostedRefusal,
    HttpClient.HttpClient | DatabaseServices
  >,
  writer: Effect.Effect<StoreWriter>,
  agent: Agent,
  { key, by }: TurnStop = {},
): Effect.fn.Return<boolean, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  // A native agent's released wait left wakeups with no turn running to name, which a Stop ends
  // as a stopped CLI's own end with it, so they go whether or not a turn stands to cancel.
  yield* hostedStoreOrUnavailable(replaceAgentWakeups(agent.id, []));
  // Every Stop, the developer's, a Continue's, another agent's, or a rewind's, pauses what is queued behind the
  // turn, so nothing more goes until Resume. Note that it pauses before the cancel goes out, because the turn's
  // end may land before the harness answers it, and would hand on a queue not yet paused.
  yield* hostedStoreOrUnavailable(pauseAgentQueue(agent.id, QUEUE_PAUSE.STOPPED));
  const turn = (yield* standingsOf([agent.conversationId]))(agent.conversationId).turn;
  if (!stoppable(turn)) return false;
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return false;
  // The cancel names the turn the row was written for, never the session's turn under way, so a
  // turn that ended between the read above and the harness's answer is answered `no_active_turn` and
  // nothing newer is stopped in its place.
  const agentSessions = yield* agentSessionsOf;
  const canceled = yield* agentSessions.cancel(sessionId, turn.runtimeTurnId).pipe(
    Effect.catchTag("SessionUnreachable", (failure) =>
      Effect.as(
        Effect.logWarning(
          `the agent's runtime could not be reached to stop a coding agent: ${describeUnreachable(failure)}`,
        ),
        {
          outcome: SESSION_CANCEL_OUTCOME.FAILED,
          status: HOSTED_HTTP_STATUS.BAD_GATEWAY,
        } as const,
      ),
    ),
  );
  if (canceled.outcome === SESSION_CANCEL_OUTCOME.FAILED) {
    return yield* Effect.fail(failedCallRefusal(canceled));
  }
  const accepted = canceled.outcome === SESSION_CANCEL_OUTCOME.ACCEPTED;
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

/**
 * The agent stopped as a Stop stops it, with nothing left to work on out of
 * sight: a session still coming up, or a line awaiting the turn it opens,
 * has no turn a Stop can name yet, so it is refused as not ready until
 * there is one to stop or it has ended.
 */
export const stoppedForGood = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  agent: Agent,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  yield* stoppedTurn(writer, account, agent);
  yield* endedOrNotReady(agent);
});

/** Refused as not ready where the agent still reads as starting or running once its Stop has gone out. */
const endedOrNotReady = /* @__PURE__ */ Effect.fnUntraced(function* (agent: Agent) {
  const status = yield* statusOf(agent);
  if (status === AGENT_STATUS.STARTING || status === AGENT_STATUS.RUNNING) {
    return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  }
});

/** How many agents a task's archive or delete reads or stops at once: under the web pool's five connections, so one request leaves room for the rest of its instance. */
const AGENT_STOP_CONCURRENCY = 3;

/** Every agent stopped for good, as `stoppedForGood` stops each, a few at once (`everySettled`). */
export const everyStoppedForGood = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  agents: readonly Agent[],
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  yield* everySettled(agents, (agent) => stoppedForGood(writer, account, agent));
});

/**
 * Every agent stopped for good as its own starter would stop it, a few at
 * once, as a workspace's delete stops them, the first refusal answered once
 * every Stop has settled. Note that each is reached through its starter's
 * account (`sessionsRouter`) rather than the owner's, because the owner
 * deletes every agent of the workspace, one on a member's own GitHub it
 * cannot see among them, and that no plan's writers are asked
 * (`admitsPlanWriter`), because the agent goes with the workspace whoever
 * pays for it.
 */
export const everyStoppedByStarter = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  agents: readonly Agent[],
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  const sessionsOf = yield* sessionsRouter;
  yield* everySettled(agents, (agent) =>
    Effect.andThen(
      canceledTurn(Effect.succeed(sessionsOf(agent.userId)), writer, agent),
      endedOrNotReady(agent),
    ),
  );
});

/**
 * Each agent's Stop, a few at once, the first refusal answered once every
 * one has settled. Note that no Stop is cut off by another's refusal,
 * because one cut off between the harness's cancel and the row's stamp
 * would leave a turn canceled that the row still reads as running.
 */
function everySettled(
  agents: readonly Agent[],
  stop: (
    agent: Agent,
  ) => Effect.Effect<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient>,
): Effect.Effect<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const stops = yield* Effect.forEach(agents, (agent) => Effect.exit(stop(agent)), {
      concurrency: AGENT_STOP_CONCURRENCY,
    });
    const refused = stops.find(Exit.isFailure);
    if (refused !== undefined) return yield* refused;
  });
}

/** Whether `stoppedForGood` would stop every agent rather than refuse one, each read as `stopsForGood` reads it, a few at once. */
export const everyStopsForGood = /* @__PURE__ */ Effect.fnUntraced(function* (
  agents: readonly Agent[],
) {
  const ready = yield* Effect.forEach(agents, stopsForGood, {
    concurrency: AGENT_STOP_CONCURRENCY,
  });
  return !ready.includes(false);
});

/**
 * Whether `stoppedForGood` would stop the agent rather than refuse it, read
 * before any Stop is sent: no line awaits the turn it opens, it is past its
 * start, and a turn still running carries the runtime's id for a Stop to name or a
 * Stop already. A caller stopping several agents as one asks this of every
 * one first, so a refusal cancels nobody's work.
 */
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

/**
 * The agents as the sidebar reads them, under their conversations' locks as a
 * task's finish and its move to Done hold them (`tasks/task-finish.ts`), each
 * beside its newest turn: a line awaiting the turn it opens reads as running,
 * and a turn whose Stop is on its way to its harness as stopped. Note that the agents
 * are read by one id list, because the transaction holds one connection and a
 * read per agent only adds trips.
 */
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

/** Whether a status the sidebar reads is neither starting nor running. */
const settledStatus = (status: AgentStatus) =>
  status !== AGENT_STATUS.STARTING && status !== AGENT_STATUS.RUNNING;

/**
 * Whether every agent stands stopped, as `standingTurns` reads each: none
 * starting, nor running, nor holding a line awaiting its turn, a turn whose
 * Stop is on its way to its harness reading as stopped, as `stoppedForGood` reads it.
 */
export const standsStopped = (agents: readonly TaskStandingAgent[]) =>
  Effect.map(standingTurns(agents), (read) => read.every(({ status }) => settledStatus(status)));

/** Whether every agent finished well, as `standingTurns` reads each: completed, none starting, running, failed, or stopped. */
export const standsFinishedWell = (agents: readonly TaskStandingAgent[]) =>
  Effect.map(standingTurns(agents), (read) =>
    read.every(({ status }) => status === AGENT_STATUS.COMPLETED),
  );

/**
 * The ids of the agents idle enough to archive, as `standingTurns` reads
 * each: stopped, and with no turn of theirs still queued or running, a Stop on
 * its way included, as the agent tools' archive reads one, since its runner
 * still holds the folder an archive discards until the turn ends.
 */
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
