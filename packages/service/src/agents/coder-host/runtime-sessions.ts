/**
 * runtime-sessions.ts -- a coding agent's sessions answered by the runtime its conversation runs on: eve as today, or a native harness Luke launches.
 *
 * Every place that reaches a coding agent's session holds one
 * `AgentSessions`: the composer, an Inbox answer, a chat notice, a GitHub
 * wake, an automation's run, the agent tools, Stop, delete, and a Start,
 * Fork, or Continue. Each composes eve's client for its caller as it always
 * has, and wraps it here (`routedSessions`), so each call is answered by the
 * implementation the conversation's `runtime` names:
 *
 * - `open` and `send` carry the conversation, whose agent and runtime are
 *   read as the caller reads them. An eve conversation, one from before the
 *   column, or one that is no coding agent's is handed to eve's client
 *   exactly as it was handed before this router stood. A native one is
 *   handed to that harness's sessions acting for the agent's starter, whose
 *   plan pays for it, and a session it opens claims the conversation's
 *   record, which eve's own door claims for an eve session.
 * - `cancel`, `reset`, and `stream` name a session alone, so they are
 *   answered by the implementation that minted it (`native-runtime.ts`):
 *   eve's sessions go to eve exactly as before.
 *
 * The native harnesses are a service of the function's own
 * (`NativeAgentSessions`, `native-agent-sessions.ts`), which only the web
 * functions that can launch the runner provide. Where it is not provided,
 * a native conversation is refused by name (`RUNTIME_REFUSAL.NOT_HERE`):
 * nothing falls through to eve, which would run it on another payer.
 *
 * TODO(P11b): the eve apps (the planner's tools in `apps/luke`, an eve
 * agent's in `apps/dev`) provide no `NativeAgentSessions`, so from there a
 * native agent is refused as `not_here` and a Start decides eve
 * (`agent-runtime-choice.ts`). P11b, `feat(agents): native agents reachable
 * from the planner and eve agents`, gives them a way to reach one.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  readCodingAgentOfConversation,
  readCodingAgentRouting,
} from "@luke/database/models/coding-agent-store";
import {
  claimRuntimeSession,
  recordedRuntimeSession,
} from "@luke/database/models/recorded-session";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { causeKind } from "@luke/runtime/effect";
import { Clock, Context, Effect, Option, Stream } from "effect";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../../http/http-effect.js";
import { IMAGE_PREPARING_STATUS } from "../agent-sandbox-image.js";
import type { BrainHostTurn } from "../brain-host/bounds.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  PLAN_REFUSAL,
  type PlanRefusal,
  RUNTIME_REFUSAL,
  type RuntimeRefusal,
} from "../brain-host/eve-sessions.js";
import { isNativeRuntime, type NativeRuntime, nativeRuntimeOfSession } from "./native-runtime.js";

/** What a change of model or effort came to at a native agent's runner. */
export const RUNNER_CHOICE = {
  /** The `model` line was written to the runner, which takes it at its next model call. */
  WRITTEN: "written",
  /** No runner runs now; the next message's launch or `model` line carries the change. */
  NOT_LIVE: "not_live",
  FAILED: "failed",
} as const;

export type RunnerChoice = (typeof RUNNER_CHOICE)[keyof typeof RUNNER_CHOICE];

/** A native harness's sessions: eve's interface, and the agent's model and effort as they stand handed to a running runner. */
export interface NativeSessions<Turn extends BrainHostTurn = BrainHostTurn>
  extends AgentSessions<Turn> {
  readonly retune: (sessionId: string, conversationId: string) => Effect.Effect<RunnerChoice>;
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
  ) => Option.Option<Effect.Effect<NativeSessions<BrainHostTurn>>>;
}

/** The native harnesses a function can launch and write to: provided by the web functions that ship the runner. */
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

/** The message as eve is handed it, as it always was: Luke's own id for its line is a native runner's alone. */
function forEve<Turn extends BrainHostTurn>(message: EveMessage<Turn>): EveMessage<Turn> {
  if (message.lineId === undefined) return message;
  const { lineId: _native, ...rest } = message;
  return rest;
}

/** Where a conversation's calls go: eve, or a native harness acting for the agent's starter. */
type Route =
  | { readonly runtime: typeof CONVERSATION_RUNTIME.EVE }
  | { readonly runtime: NativeRuntime; readonly starter: string };

const TO_EVE: Route = { runtime: CONVERSATION_RUNTIME.EVE };

/**
 * eve's client for one caller, `account`, with every call answered by the
 * runtime its conversation runs on, as above. The caller reads the
 * conversation's agent as it reads it everywhere, through its workspace.
 */
export const routedSessions = <Turn extends BrainHostTurn>(
  eve: AgentSessions<Turn>,
  account: string,
): Effect.Effect<AgentSessions<Turn>, never, DatabaseServices> =>
  Effect.map(sessionsRouter, (route) => route(eve, account));

/** Wraps eve's client for one caller as `routedSessions` does. */
export type SessionsRouter = <Turn extends BrainHostTurn>(
  eve: AgentSessions<Turn>,
  account: string,
) => AgentSessions<Turn>;

/**
 * `routedSessions` over the calling fiber's store and native harnesses,
 * read once, for a composer that wraps a client for each account it acts
 * for (`../deployment-eve.ts`, the agent doors).
 */
export const sessionsRouter: Effect.Effect<SessionsRouter, never, DatabaseServices> = Effect.gen(
  function* () {
    const store = yield* Effect.context<DatabaseServices>();
    const native = yield* Effect.serviceOption(NativeAgentSessions);
    return <Turn extends BrainHostTurn>(eve: AgentSessions<Turn>, account: string) =>
      routed(eve, account, store, native);
  },
);

function routed<Turn extends BrainHostTurn>(
  eve: AgentSessions<Turn>,
  account: string,
  store: Context.Context<DatabaseServices>,
  native: Option.Option<NativeAgentSessionsService>,
): AgentSessions<Turn> {
  /** The route of the conversation's calls, read now. */
  const routeOf = (conversationId: string) =>
    Effect.gen(function* () {
      const agent = yield* readCodingAgentOfConversation(account, conversationId);
      if (Option.isNone(agent)) return TO_EVE;
      const routing = yield* readCodingAgentRouting(account, agent.value.id);
      const runtime = Option.isSome(routing) ? routing.value.runtime : CONVERSATION_RUNTIME.EVE;
      return isNativeRuntime(runtime) ? { runtime, starter: agent.value.userId } : TO_EVE;
    }).pipe(Effect.provideContext(store));

  /** The harness's sessions acting for the account given, where this function has them. */
  const harness = (runtime: NativeRuntime, actingFor: string) =>
    Option.flatMap(native, (service) => service.sessions(runtime, actingFor));

  /** The route, or none where it could not be read, which is said in the log by its kind alone. */
  const routeOrUnread = (conversationId: string) =>
    routeOf(conversationId).pipe(
      Effect.map(Option.some),
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(`a coding agent's runtime could not be read: ${failure._tag}`),
          Option.none<Route>(),
        ),
      ),
    );

  /** The session a native open answered claimed as the conversation's record, as eve's door claims eve's; a claim that fails is logged, and the next message finds the session by its tag all the same. */
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
      Effect.provideContext(store),
    );

  const sessions: AgentSessions<Turn> = {
    open: (message) =>
      Effect.gen(function* () {
        const read = yield* routeOrUnread(message.conversationId);
        if (Option.isNone(read)) return UNREAD;
        const route = read.value;
        if (route.runtime === CONVERSATION_RUNTIME.EVE) return yield* eve.open(forEve(message));
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
        if (route.runtime === CONVERSATION_RUNTIME.EVE)
          return yield* eve.send(sessionId, forEve(message));
        const reached = harness(route.runtime, route.starter);
        if (Option.isNone(reached)) return NOT_HERE;
        return preparingNamed(yield* (yield* reached.value).send(sessionId, message));
      }),

    cancel: (sessionId, turnId) => {
      const runtime = nativeRuntimeOfSession(sessionId);
      if (runtime === undefined) return eve.cancel(sessionId, turnId);
      const reached = harness(runtime, account);
      if (Option.isNone(reached)) {
        return Effect.succeed({ ...NOT_HERE, outcome: EVE_CANCEL_OUTCOME.FAILED });
      }
      return Effect.flatMap(reached.value, (each) => each.cancel(sessionId, turnId));
    },

    reset: (sessionId) => {
      const runtime = nativeRuntimeOfSession(sessionId);
      if (runtime === undefined) return eve.reset(sessionId);
      const reached = harness(runtime, account);
      if (Option.isNone(reached)) {
        return Effect.succeed({ ...NOT_HERE, outcome: EVE_RESET_OUTCOME.FAILED });
      }
      return Effect.flatMap(reached.value, (each) => each.reset(sessionId));
    },

    // A native runner posts its events to Luke itself, so there is no stream of its session to follow.
    stream: (sessionId) =>
      nativeRuntimeOfSession(sessionId) === undefined ? eve.stream(sessionId) : Stream.empty,
  };
  return sessions;
}

/**
 * A change of the agent's model or effort, already written on its row,
 * handed to its runner where it runs one: a `model` line written now, which
 * the runner takes at its next model call, acting for the agent's starter
 * as every native call does. An agent on eve, one whose runner is not up,
 * and a function that cannot reach the harness write nothing, since eve
 * reads the row at its next step and a native agent's next message goes
 * behind the same line (`claude-code-sessions.ts`'s `ahead`). Nothing here
 * fails its caller: the row already holds the change.
 */
export const runnerChoiceApplied = (agent: {
  readonly id: string;
  readonly userId: string;
  readonly conversationId: string;
}): Effect.Effect<RunnerChoice, never, DatabaseServices> =>
  Effect.gen(function* () {
    const routing = yield* readCodingAgentRouting(agent.userId, agent.id);
    const runtime = Option.isSome(routing) ? routing.value.runtime : CONVERSATION_RUNTIME.EVE;
    if (!isNativeRuntime(runtime)) return RUNNER_CHOICE.NOT_LIVE;
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
        Effect.logWarning(`a native agent's choice did not reach its runner: ${failure._tag}`),
        RUNNER_CHOICE.FAILED,
      ),
    ),
  );

/**
 * What a call that failed answers its caller as: a native harness whose
 * image is still being prepared, which the same request later takes; a
 * native harness this function cannot reach, said by name; the starter's
 * plan refusing the launch, said by name, whose sign-in is signed in again
 * or whose provider is asked again later, and never turned to another
 * payer; or the service down, as every other failure of eve's or a
 * harness's reads.
 */
export function failedCallRefusal(failed: {
  readonly status: number;
  readonly runtimeRefusal?: RuntimeRefusal | undefined;
  readonly planRefusal?: PlanRefusal | undefined;
}): HostedRefusal {
  if (failed.planRefusal === PLAN_REFUSAL.UNREACHABLE) {
    return HOSTED_REFUSAL.AGENT_PLAN_UNREACHABLE;
  }
  if (failed.planRefusal !== undefined) return HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT;
  if (failed.runtimeRefusal === RUNTIME_REFUSAL.NOT_HERE)
    return HOSTED_REFUSAL.NATIVE_AGENT_NOT_HERE;
  if (failed.runtimeRefusal === RUNTIME_REFUSAL.IMAGE_PREPARING) {
    return HOSTED_REFUSAL.AGENT_IMAGE_PREPARING;
  }
  return HOSTED_REFUSAL.UNAVAILABLE;
}
