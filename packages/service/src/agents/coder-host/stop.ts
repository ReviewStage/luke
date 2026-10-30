import type { DatabaseServices } from "@luke/database/core/query";
import { pauseAgentQueue } from "@luke/database/models/agent-queue-store";
import {
  type Agent,
  type AgentLatestTurn,
  type AgentStartedFromIt,
  awaitingLinesOfReached,
  continuationsOf,
  latestTurnsOfReached,
  nativeRuntimesOfReached,
  RUNNING_TURN_STATUSES,
} from "@luke/database/models/agent-store";
import { replaceAgentWakeups } from "@luke/database/models/agent-wakeups";
import { devicesNamed } from "@luke/database/models/device-store";
import { recordedRuntimeSession } from "@luke/database/models/recorded-session";
import type { TaskStandingAgent } from "@luke/database/models/task-store";
import { readAccountNames } from "@luke/database/models/workspace-store";
import type { StoreWriter } from "@luke/database/models/writer";
import { QUEUE_PAUSE } from "@luke/features/agent-queue-wire";
import { AGENT_STATUS, type AgentStatus, type AgentSummary } from "@luke/features/agent-wire";
import { Clock, DateTime, Effect, Exit, Redacted, Result } from "effect";
import type { HttpClient } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedCarriesBearer,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { admitsPlanWriter } from "../agent-reach.js";
import { deploymentEve } from "../deployment-eve.js";
import type { EveHostTurn } from "../eve-host/bounds.js";
import {
  type AgentSessions,
  describeUnreachable,
  EVE_CANCEL_OUTCOME,
  EVE_MOUNT,
  type EveMount,
  eveSessions,
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

/**
 * stop.ts -- the one Stop: eve's cancel of a coding agent's turn under way, then the row's stamp.
 *
 * A Stop pressed on the agent, its archive, and the archive or the delete of
 * the task it works on all stop it here, reaching eve as the request's own
 * caller (`eveFor`); a continue of the agent stops it here too,
 * over the eve its Start reached (`start.ts`), and an agent's `stop_agent`
 * stops one as the deployment acting for the member the caller acts for
 * (`../agent-tools.ts`). The cancel names the turn the row was
 * written for, so a turn that ended meanwhile is not followed by a newer
 * one stopped in its place, and an eve that refuses leaves the row as it
 * stood and the caller unavailable. An agent stopped for good, as an
 * archive or a delete wants it, must also have no turn coming that no
 * Stop could name yet: a session still coming up, or a line awaiting the
 * turn it opens, is refused as not ready until that turn exists or has
 * ended. Every agent here was read through the caller's membership of its
 * task's workspace, so a member stops a teammate's agent on the agent's own
 * conversation, whichever of them started it.
 */

/** How a route reaches eve: the origin the deployment names, or a test's own eve. */
export interface EveReach {
  /** The origin eve answers on; nothing where the deployment names none, which refuses every Start and Stop as unavailable. */
  eveOrigin: () => string | undefined;
  /** eve as the developer reaches it, over the request's own authorization; a test hands a fake, and the deployment composes eve's client over the ambient `HttpClient`. */
  eve?: (authorization: Redacted.Redacted) => AgentSessions;
  /** eve as the deployment reaches it acting for an account, for a request that carried the browser's session cookie and no bearer; a test hands a fake, and the deployment composes eve's client under its own secret. */
  eveAs?: (account: string) => AgentSessions;
}

/**
 * eve as the request's own caller reaches it, the coding agents' service
 * unless another is named. A request that carries a bearer reaches eve over
 * that bearer, as it always has, and eve verifies the account itself. A
 * request that carries none is one a browser's session cookie named
 * (`hostedCarriesBearer`, the question `auth/bearer.ts`'s `requestUserId`
 * asks too), which eve's channels never read, so it reaches eve as the
 * deployment acting for the account, under the deployment's own secret
 * (`../deployment-eve.ts`): the channel's door admits that caller only for
 * what its actor admits (`eve-host/auth.ts`), and only on a session or a
 * conversation the account reaches, as it holds every caller. `account` is
 * the one the route resolved from this request (`resolveUserId`), never one
 * a request or a row names, so the cookie names the account eve acts for
 * exactly as the bearer would have. A deployment that names no origin for
 * eve, or no secret for a cookie's request, answers unavailable.
 *
 * The client sends the kinds of turn `Turn` names and none unless a caller
 * names one, so a route that holds it to stop, retire, or follow a session
 * cannot open or steer one: a route that sends the account's words asks for
 * `EveTypedTurn` by name.
 */
export function eveFor<Turn extends EveHostTurn = never>(
  reach: EveReach,
  request: Request,
  account: string,
  mount: EveMount = EVE_MOUNT.CODER,
): Effect.Effect<
  AgentSessions<NoInfer<Turn>>,
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
> {
  // A coding agent's session is answered by the runtime its conversation runs on (`runtime-sessions.ts`).
  const routed = (eve: AgentSessions<NoInfer<Turn>>) =>
    mount === EVE_MOUNT.CODER ? routedSessions(eve, account) : Effect.succeed(eve);
  return Effect.gen(function* () {
    if (hostedCarriesBearer(request)) {
      const authorization = Redacted.make(request.headers.get("authorization") ?? "");
      if (reach.eve !== undefined) return yield* routed(reach.eve(authorization));
      const origin = reach.eveOrigin();
      if (origin === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* routed(yield* eveSessions<Turn>({ origin, caller: { authorization }, mount }));
    }
    if (reach.eveAs !== undefined) return yield* routed(reach.eveAs(account));
    // Note that a runtime without the deployment's environment refuses a cookie's request as
    // unavailable on purpose, as one whose environment names no secret does: the deployment acts
    // for no account it cannot prove itself to eve as, and nothing falls back to another caller.
    const eveAs = yield* deploymentEve<Turn>(reach.eveOrigin(), mount);
    return eveAs(account);
  });
}

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
  return agentSummary(
    agent,
    standing(agent.conversationId),
    yield* Clock.currentTimeMillis,
    names,
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

/** Whether the turn is one a Stop has something to stop: still running, with eve's id to name, and no Stop on it yet. */
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

/** What made a Stop, written on the turn's row beside its instant (`TurnCancelRequest`): none of it for a member's Stop. */
export interface TurnStop {
  /** eve's id for the tool call the Stop is made under, where an agent's `stop_agent` made it. */
  readonly key?: string;
  /** The coding agent whose `stop_agent` or continue makes the Stop; none for the developer's or Luke's. */
  readonly by?: string;
}

/** eve's cancel of the agent's turn under way, as the request's own caller for the account it resolved to (`eveFor`), then the row's stamp, and whether eve took it (`cancelledTurn`); nothing where no turn runs that a Stop has to stop. */
export const stoppedTurn = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: EveReach,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  account: string,
  agent: Agent,
  stop: TurnStop = {},
): Effect.fn.Return<boolean, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  // An agent its starter's plan pays for is stopped by those the plan's policy admits.
  yield* admitsPlanWriter(account, agent);
  return yield* cancelledTurn(eveFor(reach, request, account), writer, agent, stop);
});

/**
 * eve's cancel of the agent's turn under way, over the eve given, then the
 * row's stamp, and whether eve took the cancel; nothing, and false, where no
 * turn runs that a Stop has to stop, a turn already stamped among them, so a
 * second Stop asks eve nothing. A turn eve says ended meanwhile is stamped
 * all the same but answered false, since this Stop stopped nothing. eve is
 * composed only once there is a turn to cancel. A tool call's Stop names its
 * key, written beside the stamp where eve took the cancel, so the call run
 * again finds the turn it stopped, and one that stopped nothing is run
 * again as it first ran; who made the Stop is written beside it as `stop`
 * names it.
 */
export const cancelledTurn = /* @__PURE__ */ Effect.fnUntraced(function* (
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
  // A native agent's released wait left wakeups with no turn running to name, which a Stop ends
  // as a stopped CLI's own end with it, so they go whether or not a turn stands to cancel.
  yield* hostedStoreOrUnavailable(replaceAgentWakeups(agent.id, []));
  // Every Stop, the developer's, a Continue's, another agent's, or a rewind's, pauses what is queued behind the
  // turn, so nothing more goes until Resume. Note that it pauses before the cancel goes out, because the turn's
  // end may land before eve answers it, and would hand on a queue not yet paused.
  yield* hostedStoreOrUnavailable(pauseAgentQueue(agent.id, QUEUE_PAUSE.STOPPED));
  const turn = (yield* standingsOf([agent.conversationId]))(agent.conversationId).turn;
  if (!stoppable(turn)) return false;
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return false;
  // The cancel names the turn the row was written for, never the session's turn under way, so a
  // turn that ended between the read above and eve's answer is answered `no_active_turn` and
  // nothing newer is stopped in its place.
  const eve = yield* eveOf;
  const cancelled = yield* eve
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
  if (cancelled.outcome === EVE_CANCEL_OUTCOME.FAILED) {
    return yield* Effect.fail(failedCallRefusal(cancelled));
  }
  const accepted = cancelled.outcome === EVE_CANCEL_OUTCOME.ACCEPTED;
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
  reach: EveReach,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  account: string,
  agent: Agent,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  yield* stoppedTurn(reach, writer, request, account, agent);
  const status = yield* statusOf(agent);
  if (status === AGENT_STATUS.STARTING || status === AGENT_STATUS.RUNNING) {
    return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  }
});

/** How many agents a task's archive or delete reads or stops at once: under the web pool's five connections, so one request leaves room for the rest of its instance. */
const AGENT_STOP_CONCURRENCY = 3;

/**
 * Every agent stopped for good, as `stoppedForGood` stops each, a few at
 * once; the first refusal answered once every Stop has settled.
 * Note that no Stop is cut off by another's refusal, because one cut off
 * between eve's cancel and the row's stamp would leave a turn cancelled
 * that the row still reads as running.
 */
export const everyStoppedForGood = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: EveReach,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  account: string,
  agents: readonly Agent[],
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient> {
  const stops = yield* Effect.forEach(
    agents,
    (agent) => Effect.exit(stoppedForGood(reach, writer, request, account, agent)),
    { concurrency: AGENT_STOP_CONCURRENCY },
  );
  const refused = stops.find(Exit.isFailure);
  if (refused !== undefined) return yield* refused;
});

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
 * start, and a turn still running carries eve's id for a Stop to name or a
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
 * and a turn whose Stop is on its way to eve as stopped. Note that the agents
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
 * Stop is on its way to eve reading as stopped, as `stoppedForGood` reads it.
 */
export const standsStopped = (agents: readonly TaskStandingAgent[]) =>
  Effect.map(standingTurns(agents), (read) => read.every(({ status }) => settledStatus(status)));

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
