/**
 * runtime-sessions.ts -- a coding agent's sessions answered by the native harness its conversation runs on, and an agent left on eve refused as ended.
 *
 * Every place that reaches a coding agent's session holds one
 * `AgentSessions`: the composer, an Inbox answer, another agent's message, a GitHub
 * wake, an automation's run, the agent tools, Stop, delete, and a Start,
 * Fork, or Continue. Each reads it here for the account it acts for
 * (`routedSessions`), so each call is answered by the implementation the
 * conversation's `runtime` names:
 *
 * - `open` and `send` carry the conversation, whose agent and runtime are
 *   read as the caller reads them. One that runs on no harness
 *   (`harnessOf`), or is no coding agent's, has ended for good, and is
 *   refused so (`RUNTIME_REFUSAL.ENDED`, read as `AGENT_RETIRED`): a new
 *   agent goes on from its work, as Continue or `start_agent`'s `from`
 *   starts one. A native one is
 *   handed to that harness's sessions acting for the agent's starter, whose
 *   plan pays for it, and a session it opens claims the conversation's
 *   record.
 * - `cancel` and `reset` name a session alone, so they are
 *   answered by the harness that minted it (`native-runtime.ts`); a session
 *   no harness minted runs no turn and holds nothing, so it is answered so
 *   here, and a Stop or a delete of an agent whose session ended goes on.
 *
 * The native harnesses are a service of the function's own
 * (`NativeAgentSessions`): the harnesses themselves in the web functions
 * that ship the runner (`native-agent-sessions.ts`). Where it is not
 * provided, a native conversation is refused by name
 * (`RUNTIME_REFUSAL.NOT_HERE`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { readAgentHeaderOfConversation, readAgentRouting } from "@repo/database/models/agent-store";
import {
  claimRuntimeSession,
  recordedRuntimeSession,
} from "@repo/database/models/recorded-session";
import { LOCAL_AGENT_REFUSAL } from "@repo/features/agent-wire";
import { causeKind, failureKind } from "@repo/runtime/effect";
import { Clock, Context, Effect, Option } from "effect";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  localAgentRefused,
  planLimitReached,
} from "../../http/http-effect.js";
import { IMAGE_PREPARING_STATUS } from "../agent-sandbox-image.js";
import type { EveHostTurn } from "../eve-host/bounds.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  KEY_REFUSAL,
  type KeyRefusal,
  PLAN_REFUSAL,
  type PlanRefusal,
  RUNTIME_REFUSAL,
  type RuntimeRefusal,
} from "../eve-host/eve-sessions.js";
import { agentLogIds } from "./agent-log.js";
import { harnessOf, type NativeRuntime, nativeRuntimeOfSession } from "./native-runtime.js";

/** What a change of model or effort came to at a native agent's runner. */
export const RUNNER_CHOICE = {
  /** The `model` line was written to the runner, which takes it at its next model call. */
  WRITTEN: "written",
  /** No runner runs now; the next message's launch or `model` line carries the change. */
  NOT_LIVE: "not_live",
  FAILED: "failed",
} as const;

export type RunnerChoice = (typeof RUNNER_CHOICE)[keyof typeof RUNNER_CHOICE];

/** What a repository added beside a native agent's own came to at the place it runs in. */
export const RUNNER_CHECKOUT = {
  /** The credential was set for the whole set and the repository cloned into the running place. */
  CHECKED_OUT: "checked_out",
  /** No place runs now; the next launch clones it with the credential it sets. */
  NOT_LIVE: "not_live",
  FAILED: "failed",
} as const;

export type RunnerCheckout = (typeof RUNNER_CHECKOUT)[keyof typeof RUNNER_CHECKOUT];

/** A native harness's sessions: eve's interface, the agent's model and effort as they stand handed to a running runner, and its repositories as they stand checked out in the place it runs in. */
export interface NativeSessions<Turn extends EveHostTurn = EveHostTurn>
  extends AgentSessions<Turn> {
  readonly retune: (sessionId: string, conversationId: string) => Effect.Effect<RunnerChoice>;
  /** The agent's credential set afresh for every repository it works in and each one the running place does not hold cloned there (`runner-sessions.ts`); not live where no place runs. */
  readonly checkOut: (sessionId: string, conversationId: string) => Effect.Effect<RunnerCheckout>;
  /** The session's runner ended, keeping its sandbox and the harness's session, so the next message relaunches it; whether no runner runs now. */
  readonly halt: (sessionId: string, conversationId: string) => Effect.Effect<boolean>;
  /** The message lines an ended launch never took handed to a runner launched for them, where none runs (`runner-sessions.ts`'s `LINES_WAITING`); whether one was launched. */
  readonly deliverWaiting: (sessionId: string, conversationId: string) => Effect.Effect<boolean>;
}

export interface NativeAgentSessionsService {
  /**
   * The native harness's sessions, acting for the account given: the
   * agent's starter for a launch or a message, whose plan the launch runs
   * on. None for a harness this function cannot launch.
   */
  readonly sessions: (
    runtime: NativeRuntime,
    account: string,
  ) => Option.Option<Effect.Effect<NativeSessions<EveHostTurn>>>;
}

/** The native harnesses a function can launch and write to: the harnesses in the web functions that ship the runner, a relay to them in the eve app. */
export class NativeAgentSessions extends Context.Service<
  NativeAgentSessions,
  NativeAgentSessionsService
>()("NativeAgentSessions") {}

/** What a call to a native conversation answers where this function cannot reach its harness. */
const NOT_HERE = {
  outcome: EVE_SEND_OUTCOME.FAILED,
  status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  runtimeRefusal: RUNTIME_REFUSAL.NOT_HERE,
} as const;

/** What an open or a send to an agent whose session ended for good answers: nothing reaches it again. */
const ENDED = {
  outcome: EVE_SEND_OUTCOME.FAILED,
  status: HOSTED_HTTP_STATUS.CONFLICT,
  runtimeRefusal: RUNTIME_REFUSAL.ENDED,
} as const;

/** What a call answers where the conversation's runtime could not be read. */
const UNREAD = {
  outcome: EVE_SEND_OUTCOME.FAILED,
  status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
} as const;

/** A harness's failure while its image is still being prepared, named as such, so its caller retries rather than fails the agent. */
function preparingNamed<Outcome extends { readonly outcome: string }>(answered: Outcome): Outcome {
  return answered.outcome === EVE_SEND_OUTCOME.FAILED &&
    "status" in answered &&
    answered.status === IMAGE_PREPARING_STATUS
    ? { ...answered, runtimeRefusal: RUNTIME_REFUSAL.IMAGE_PREPARING }
    : answered;
}

/** What a cancel of a session no harness minted answers: it ended for good, so no turn of it is under way. */
const NO_TURN = { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;

/** What a retire of a session no harness minted answers: it ended for good, so it holds nothing to let go of. */
const NO_SESSION = { outcome: EVE_RESET_OUTCOME.NO_ACTIVE_SESSION } as const;

/** Where the calls of a conversation on no harness, or of one that is no coding agent's, go: nowhere, since its session ended for good. */
const ENDED_ROUTE = { ended: true } as const;

/** Where a conversation's calls go: a native harness acting for the agent's starter, or nowhere. */
type Route = { readonly runtime: NativeRuntime; readonly starter: string } | typeof ENDED_ROUTE;

/**
 * The sessions of one caller, `account`, with every call answered by the
 * runtime its conversation runs on, as above. The caller reads the
 * conversation's agent as it reads it everywhere, through its workspace.
 */
export const routedSessions = <Turn extends EveHostTurn>(
  account: string,
): Effect.Effect<AgentSessions<Turn>, never, DatabaseServices> =>
  Effect.map(sessionsRouter, (route) => route<Turn>(account));

/** The sessions of each account a composer acts for, as `routedSessions` reads them. */
export type SessionsRouter = <Turn extends EveHostTurn>(account: string) => AgentSessions<Turn>;

/**
 * `routedSessions` over the calling fiber's store and native harnesses,
 * read once, for a caller that acts for more than one account (a queue's
 * members, a sweep's agents, the agent doors).
 */
export const sessionsRouter: Effect.Effect<SessionsRouter, never, DatabaseServices> = Effect.gen(
  function* () {
    const store = yield* Effect.context<DatabaseServices>();
    const native = yield* Effect.serviceOption(NativeAgentSessions);
    return <Turn extends EveHostTurn>(account: string) => routed<Turn>(account, store, native);
  },
);

function routed<Turn extends EveHostTurn>(
  account: string,
  store: Context.Context<DatabaseServices>,
  native: Option.Option<NativeAgentSessionsService>,
): AgentSessions<Turn> {
  const routeOf = (conversationId: string) =>
    Effect.gen(function* () {
      const agent = yield* readAgentHeaderOfConversation(account, conversationId);
      if (Option.isNone(agent)) return ENDED_ROUTE;
      const routing = yield* readAgentRouting(account, agent.value.id);
      const runtime = harnessOf(Option.getOrUndefined(routing)?.runtime);
      return runtime === undefined ? ENDED_ROUTE : { runtime, starter: agent.value.userId };
    }).pipe(Effect.provideContext(store));

  /** The harness's sessions acting for the account given, where this function has them. */
  const harness = (runtime: NativeRuntime, actingFor: string) =>
    Option.flatMap(native, (service) => service.sessions(runtime, actingFor));

  /** The route, or none where it could not be read, which is said in the log by its kind alone, naming the conversation. */
  const routeOrUnread = (conversationId: string) =>
    routeOf(conversationId).pipe(
      Effect.map(Option.some),
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(`a coding agent's runtime could not be read: ${failureKind(failure)}`),
          Option.none<Route>(),
        ),
      ),
      Effect.annotateLogs(agentLogIds({ conversationId })),
    );

  /** The session a native open answered claimed as the conversation's record; a claim that fails is logged, and the next message finds the session by its tag all the same. */
  const claimed = (starter: string, message: EveMessage<Turn>, sessionId: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* claimRuntimeSession(
        { userId: starter, conversationId: message.conversationId },
        sessionId,
        new Date(now),
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(`a native session did not claim its record: ${causeKind(cause)}`),
      ),
      Effect.annotateLogs(agentLogIds({ conversationId: message.conversationId }, sessionId)),
      Effect.provideContext(store),
    );

  const sessions: AgentSessions<Turn> = {
    open: (message) =>
      Effect.gen(function* () {
        const read = yield* routeOrUnread(message.conversationId);
        if (Option.isNone(read)) return UNREAD;
        const route = read.value;
        if ("ended" in route) return ENDED;
        const reached = harness(route.runtime, route.starter);
        if (Option.isNone(reached)) return NOT_HERE;
        const opened = yield* (yield* reached.value).open(message);
        if (opened.outcome === EVE_SEND_OUTCOME.ACCEPTED) {
          yield* claimed(route.starter, message, opened.sessionId);
        }
        return preparingNamed(opened);
      }),

    send: (sessionId, message) =>
      Effect.gen(function* () {
        const read = yield* routeOrUnread(message.conversationId);
        if (Option.isNone(read)) return UNREAD;
        const route = read.value;
        if ("ended" in route) return ENDED;
        const reached = harness(route.runtime, route.starter);
        if (Option.isNone(reached)) return NOT_HERE;
        return preparingNamed(yield* (yield* reached.value).send(sessionId, message));
      }),

    cancel: (sessionId, turnId) => {
      const runtime = nativeRuntimeOfSession(sessionId);
      if (runtime === undefined) return Effect.succeed(NO_TURN);
      const reached = harness(runtime, account);
      if (Option.isNone(reached)) {
        return Effect.succeed({ ...NOT_HERE, outcome: EVE_CANCEL_OUTCOME.FAILED });
      }
      return Effect.flatMap(reached.value, (each) => each.cancel(sessionId, turnId));
    },

    reset: (sessionId) => {
      const runtime = nativeRuntimeOfSession(sessionId);
      if (runtime === undefined) return Effect.succeed(NO_SESSION);
      const reached = harness(runtime, account);
      if (Option.isNone(reached)) {
        return Effect.succeed({ ...NOT_HERE, outcome: EVE_RESET_OUTCOME.FAILED });
      }
      return Effect.flatMap(reached.value, (each) => each.reset(sessionId));
    },
  };
  return sessions;
}

/**
 * A change of the agent's model or effort, already written on its row,
 * handed to its runner where it runs one: a `model` line written now, which
 * the runner takes at its next model call, acting for the agent's starter
 * as every native call does. An agent on no harness, whose session ended,
 * one whose runner is not up, and a function that cannot reach the harness
 * write nothing, since the agent's next message goes behind the same line
 * (`claude-code-sessions.ts`'s `ahead`). Nothing here
 * fails its caller: the row already holds the change.
 */
export const runnerChoiceApplied = (agent: {
  readonly id: string;
  readonly userId: string;
  readonly conversationId: string;
}): Effect.Effect<RunnerChoice, never, DatabaseServices> =>
  Effect.gen(function* () {
    const routing = yield* readAgentRouting(agent.userId, agent.id);
    const runtime = harnessOf(Option.getOrUndefined(routing)?.runtime);
    if (runtime === undefined) return RUNNER_CHOICE.NOT_LIVE;
    const native = yield* Effect.serviceOption(NativeAgentSessions);
    const reached = Option.flatMap(native, (service) => service.sessions(runtime, agent.userId));
    if (Option.isNone(reached)) return RUNNER_CHOICE.NOT_LIVE;
    const sessionId = yield* recordedRuntimeSession({
      userId: agent.userId,
      conversationId: agent.conversationId,
    });
    if (sessionId === undefined || nativeRuntimeOfSession(sessionId) === undefined) {
      return RUNNER_CHOICE.NOT_LIVE;
    }
    return yield* (yield* reached.value).retune(sessionId, agent.conversationId);
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `a native agent's choice did not reach its runner: ${failureKind(failure)}`,
        ),
        RUNNER_CHOICE.FAILED,
      ),
    ),
    Effect.annotateLogs(agentLogIds(agent)),
  );

/**
 * A repository added beside the agent's own, already written among its
 * repositories, handed to the place its session runs in now, acting for the
 * agent's starter as every native call does: its credential set afresh for
 * the whole set and the repository cloned there. An agent on no harness, one
 * whose session never claimed its record, one whose place is not running,
 * and a function that cannot reach the harness clone nothing now, since the
 * next launch clones it. Nothing here fails its caller: the row already
 * holds the repository.
 */
export const runnerCheckedOut = (agent: {
  readonly id: string;
  readonly userId: string;
  readonly conversationId: string;
}): Effect.Effect<RunnerCheckout, never, DatabaseServices> =>
  Effect.gen(function* () {
    const routing = yield* readAgentRouting(agent.userId, agent.id);
    const runtime = harnessOf(Option.getOrUndefined(routing)?.runtime);
    if (runtime === undefined) return RUNNER_CHECKOUT.NOT_LIVE;
    const native = yield* Effect.serviceOption(NativeAgentSessions);
    const reached = Option.flatMap(native, (service) => service.sessions(runtime, agent.userId));
    if (Option.isNone(reached)) return RUNNER_CHECKOUT.NOT_LIVE;
    const sessionId = yield* recordedRuntimeSession({
      userId: agent.userId,
      conversationId: agent.conversationId,
    });
    if (sessionId === undefined || nativeRuntimeOfSession(sessionId) === undefined) {
      return RUNNER_CHECKOUT.NOT_LIVE;
    }
    return yield* (yield* reached.value).checkOut(sessionId, agent.conversationId);
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `a native agent's added repository did not reach its place: ${failureKind(failure)}`,
        ),
        RUNNER_CHECKOUT.FAILED,
      ),
    ),
    Effect.annotateLogs(agentLogIds(agent)),
  );

/**
 * The native agent's runner ended for a rewind, acting for the agent's
 * starter, keeping its sandbox and the harness's session for the next
 * message's launch to cut and resume: whether no runner runs now. A
 * function that cannot reach the harness, or a store that cannot be read,
 * answers false, so the rewind cuts nothing a runner still writes to.
 */
export const runnerHalted = (
  agent: { readonly id: string; readonly userId: string; readonly conversationId: string },
  runtime: NativeRuntime,
  sessionId: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const native = yield* Effect.serviceOption(NativeAgentSessions);
    const reached = Option.flatMap(native, (service) => service.sessions(runtime, agent.userId));
    if (Option.isNone(reached)) return false;
    return yield* (yield* reached.value).halt(sessionId, agent.conversationId);
  });

/**
 * What a call that failed answers its caller as: an agent whose session
 * ended for good, as ended, which only a new agent goes on from; a native harness whose
 * image is still being prepared, which the same request later takes; a
 * native harness this function cannot reach, said by name; the starter's
 * plan refusing the launch, said by name, whose sign-in is signed in again
 * or whose provider is asked again later, and never turned to another
 * payer; the starter's API key gone or unreadable, said by name, which only
 * saving it again mends; an agent's device away, refused as a Start on it
 * is; or the service down, as every other failure of eve's or a harness's
 * reads.
 */
export function failedCallRefusal(failed: {
  readonly status: number;
  readonly runtimeRefusal?: RuntimeRefusal | undefined;
  readonly planRefusal?: PlanRefusal | undefined;
  readonly planResetsAt?: number | undefined;
  readonly keyRefusal?: KeyRefusal | undefined;
}): HostedRefusal {
  if (failed.keyRefusal === KEY_REFUSAL.UNREADABLE) return HOSTED_REFUSAL.AGENT_API_KEY_UNREADABLE;
  if (failed.keyRefusal === KEY_REFUSAL.MISSING) return HOSTED_REFUSAL.AGENT_CREDENTIAL_MISSING;
  if (failed.planRefusal === PLAN_REFUSAL.UNREACHABLE) {
    return HOSTED_REFUSAL.AGENT_PLAN_UNREACHABLE;
  }
  if (failed.planRefusal === PLAN_REFUSAL.LIMIT_REACHED) {
    return planLimitReached(failed.planResetsAt);
  }
  if (failed.planRefusal === PLAN_REFUSAL.INELIGIBLE) return HOSTED_REFUSAL.AGENT_PLAN_INELIGIBLE;
  if (failed.planRefusal !== undefined) return HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT;
  if (failed.runtimeRefusal === RUNTIME_REFUSAL.ENDED) return HOSTED_REFUSAL.AGENT_RETIRED;
  if (failed.runtimeRefusal === RUNTIME_REFUSAL.NOT_HERE)
    return HOSTED_REFUSAL.NATIVE_AGENT_NOT_HERE;
  if (failed.runtimeRefusal === RUNTIME_REFUSAL.IMAGE_PREPARING) {
    return HOSTED_REFUSAL.AGENT_IMAGE_PREPARING;
  }
  if (failed.runtimeRefusal === RUNTIME_REFUSAL.DEVICE_REMOVED)
    return HOSTED_REFUSAL.DEVICE_REMOVED;
  // Note that an away device refuses a message as it refuses a Start, so the words are the same.
  if (failed.runtimeRefusal === RUNTIME_REFUSAL.DEVICE_AWAY) {
    return localAgentRefused(LOCAL_AGENT_REFUSAL.MAC_AWAY);
  }
  return HOSTED_REFUSAL.UNAVAILABLE;
}
