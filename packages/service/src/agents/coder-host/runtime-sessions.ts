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

export const RUNNER_CHOICE = {
  WRITTEN: "written",
  NOT_LIVE: "not_live",
  FAILED: "failed",
} as const;

export type RunnerChoice = (typeof RUNNER_CHOICE)[keyof typeof RUNNER_CHOICE];

export const RUNNER_CHECKOUT = {
  CHECKED_OUT: "checked_out",
  NOT_LIVE: "not_live",
  FAILED: "failed",
} as const;

export type RunnerCheckout = (typeof RUNNER_CHECKOUT)[keyof typeof RUNNER_CHECKOUT];

export interface NativeSessions<Turn extends EveHostTurn = EveHostTurn>
  extends AgentSessions<Turn> {
  readonly retune: (sessionId: string, conversationId: string) => Effect.Effect<RunnerChoice>;
  readonly checkOut: (sessionId: string, conversationId: string) => Effect.Effect<RunnerCheckout>;
  readonly halt: (sessionId: string, conversationId: string) => Effect.Effect<boolean>;
  readonly deliverWaiting: (sessionId: string, conversationId: string) => Effect.Effect<boolean>;
}

export interface NativeAgentSessionsService {
  readonly sessions: (
    runtime: NativeRuntime,
    account: string,
  ) => Option.Option<Effect.Effect<NativeSessions<EveHostTurn>>>;
}

export class NativeAgentSessions extends Context.Service<
  NativeAgentSessions,
  NativeAgentSessionsService
>()("NativeAgentSessions") {}

const NOT_HERE = {
  outcome: EVE_SEND_OUTCOME.FAILED,
  status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  runtimeRefusal: RUNTIME_REFUSAL.NOT_HERE,
} as const;

const ENDED = {
  outcome: EVE_SEND_OUTCOME.FAILED,
  status: HOSTED_HTTP_STATUS.CONFLICT,
  runtimeRefusal: RUNTIME_REFUSAL.ENDED,
} as const;

const UNREAD = {
  outcome: EVE_SEND_OUTCOME.FAILED,
  status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
} as const;

const NO_TURN = { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;

const NO_SESSION = { outcome: EVE_RESET_OUTCOME.NO_ACTIVE_SESSION } as const;

const ENDED_ROUTE = { ended: true } as const;

type Route = { readonly runtime: NativeRuntime; readonly starter: string } | typeof ENDED_ROUTE;

export const routedSessions = <Turn extends EveHostTurn>(
  account: string,
): Effect.Effect<AgentSessions<Turn>, never, DatabaseServices> =>
  Effect.map(sessionsRouter, (route) => route<Turn>(account));

export type SessionsRouter = <Turn extends EveHostTurn>(account: string) => AgentSessions<Turn>;

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

  const harness = (runtime: NativeRuntime, actingFor: string) =>
    Option.flatMap(native, (service) => service.sessions(runtime, actingFor));

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
        return opened;
      }),

    send: (sessionId, message) =>
      Effect.gen(function* () {
        const read = yield* routeOrUnread(message.conversationId);
        if (Option.isNone(read)) return UNREAD;
        const route = read.value;
        if ("ended" in route) return ENDED;
        const reached = harness(route.runtime, route.starter);
        if (Option.isNone(reached)) return NOT_HERE;
        return yield* (yield* reached.value).send(sessionId, message);
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
  if (failed.runtimeRefusal === RUNTIME_REFUSAL.DEVICE_REMOVED)
    return HOSTED_REFUSAL.DEVICE_REMOVED;
  if (failed.runtimeRefusal === RUNTIME_REFUSAL.DEVICE_AWAY) {
    return localAgentRefused(LOCAL_AGENT_REFUSAL.MAC_AWAY);
  }
  return HOSTED_REFUSAL.UNAVAILABLE;
}
