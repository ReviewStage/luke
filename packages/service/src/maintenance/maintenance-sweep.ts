import type { DatabaseServices } from "@repo/database/core/query";
import { causeKind } from "@repo/runtime/effect";
import { Cause, Clock, Data, Effect, type Redacted } from "effect";
import type { SessionSandboxSweepOutcome } from "../agents/session-sandboxes.js";
import type { AutomationSweepOutcome } from "../automations/automation-sweep.js";
import { GitHubBackground } from "../github/github-rate-gate.js";
import type { TokenPullRequestSweepOutcome } from "../github/token-pull-request-sweep.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";
import type { CodexPlanSweepOutcome } from "./codex-plan-sweep.js";
import type { DeviceLeaseSweepOutcome } from "./device-lease-sweep.js";
import type { DeviceWarmSweepOutcome } from "./device-warm-sweep.js";
import type { NativeSandboxSweepOutcome } from "./native-sandbox-sweep.js";
import type { NativeWakeupSweepOutcome } from "./native-wakeup-sweep.js";

type SweepRead<A> = Effect.Effect<A, unknown, DatabaseServices>;

interface MaintenanceSweeps {
  purgeCleared: (now: number) => SweepRead<number>;
  sweepAbandonedTurns: (now: number) => SweepRead<number>;
  sweepDeviceLeases: (now: number) => SweepRead<DeviceLeaseSweepOutcome>;
  sweepDeviceWarmRunners: (now: number) => SweepRead<DeviceWarmSweepOutcome>;
  sweepSandboxes: (now: number) => SweepRead<SessionSandboxSweepOutcome>;
  sweepNativeSandboxes: (now: number) => SweepRead<NativeSandboxSweepOutcome>;
  sweepNativeWakeups: (now: number) => SweepRead<NativeWakeupSweepOutcome>;
  purgeWithdrawnLines: (now: number) => SweepRead<number>;
  sweepAutomations: (now: number) => SweepRead<AutomationSweepOutcome>;
  purgeUnsavedPictures: (now: number) => SweepRead<number>;
  sweepTokenPullRequests: (now: number) => SweepRead<TokenPullRequestSweepOutcome>;
  sweepAgentQueues: (now: number) => SweepRead<number>;
  sweepHostPairings: (now: number) => SweepRead<number>;
  pruneSyncLog: (now: number) => SweepRead<number>;
  purgeStaleFirewalls: (now: number) => SweepRead<number>;
  renewCodexPlanSwaps: (now: number) => SweepRead<CodexPlanSweepOutcome>;
}

interface SweepMonitor {
  readonly run: <A, E, R>(sweep: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export interface MaintenanceSweepOptions extends MaintenanceSweeps {
  request: Request;
  cronSecret: Redacted.Redacted | undefined;
  monitor: SweepMonitor;
}

interface MaintenanceSweepAnswer {
  purged: Swept<number>;
  abandoned: Swept<number>;
  deviceLeases: Swept<DeviceLeaseSweepOutcome>;
  deviceWarmRunners: Swept<DeviceWarmSweepOutcome>;
  sandboxes: Swept<SessionSandboxSweepOutcome>;
  nativeSandboxes: Swept<NativeSandboxSweepOutcome>;
  nativeWakeups: Swept<NativeWakeupSweepOutcome>;
  withdrawnLines: Swept<number>;
  automations: Swept<AutomationSweepOutcome>;
  purgedPictures: Swept<number>;
  tokenPullRequests: Swept<TokenPullRequestSweepOutcome>;
  agentQueues: Swept<number>;
  hostPairings: Swept<number>;
  syncLog: Swept<number>;
  staleFirewalls: Swept<number>;
  codexPlanSwaps: Swept<CodexPlanSweepOutcome>;
}

export const SWEEP_FAILED = { failed: true } as const;

type Swept<A> = A | typeof SWEEP_FAILED;

class SweepsFailed extends Data.TaggedError("SweepsFailed")<{
  readonly answer: MaintenanceSweepAnswer;
}> {}

const isolated = <A>(name: string, sweep: SweepRead<A>): SweepRead<Swept<A>> =>
  sweep.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.as(Effect.logError(`the ${name} sweep failed: ${causeKind(cause)}`), SWEEP_FAILED),
    ),
  );

const sweepAll = /* @__PURE__ */ Effect.fn("web/sweepAll")(function* (
  sweeps: MaintenanceSweeps,
): Effect.fn.Return<MaintenanceSweepAnswer, unknown, DatabaseServices> {
  const now = yield* Clock.currentTimeMillis;
  return {
    purged: yield* isolated("purgeCleared", sweeps.purgeCleared(now)),
    abandoned: yield* isolated("sweepAbandonedTurns", sweeps.sweepAbandonedTurns(now)),
    deviceLeases: yield* isolated("sweepDeviceLeases", sweeps.sweepDeviceLeases(now)),
    deviceWarmRunners: yield* isolated(
      "sweepDeviceWarmRunners",
      sweeps.sweepDeviceWarmRunners(now),
    ),
    sandboxes: yield* isolated("sweepSandboxes", sweeps.sweepSandboxes(now)),
    nativeSandboxes: yield* isolated("sweepNativeSandboxes", sweeps.sweepNativeSandboxes(now)),
    nativeWakeups: yield* isolated("sweepNativeWakeups", sweeps.sweepNativeWakeups(now)),
    withdrawnLines: yield* isolated("purgeWithdrawnLines", sweeps.purgeWithdrawnLines(now)),
    automations: yield* isolated("sweepAutomations", sweeps.sweepAutomations(now)),
    purgedPictures: yield* isolated("purgeUnsavedPictures", sweeps.purgeUnsavedPictures(now)),
    tokenPullRequests: yield* isolated(
      "sweepTokenPullRequests",
      sweeps.sweepTokenPullRequests(now),
    ),
    agentQueues: yield* isolated("sweepAgentQueues", sweeps.sweepAgentQueues(now)),
    hostPairings: yield* isolated("sweepHostPairings", sweeps.sweepHostPairings(now)),
    syncLog: yield* isolated("pruneSyncLog", sweeps.pruneSyncLog(now)),
    staleFirewalls: yield* isolated("purgeStaleFirewalls", sweeps.purgeStaleFirewalls(now)),
    codexPlanSwaps: yield* isolated("renewCodexPlanSwaps", sweeps.renewCodexPlanSwaps(now)),
  };
});

export const handleMaintenanceSweep = /* @__PURE__ */ Effect.fn("web/handleMaintenanceSweep")(
  function* (
    options: MaintenanceSweepOptions,
  ): Effect.fn.Return<Response, unknown, DatabaseServices> {
    const { request } = options;
    if (request.method !== "GET") {
      return errorResponse(
        HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      );
    }
    const secret = options.cronSecret;
    if (secret === undefined) {
      return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
    }
    if (!bearerMatchesSecret(request, secret)) {
      return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
    }

    const ran: MaintenanceSweepAnswer | SweepsFailed = yield* options.monitor
      .run(
        Effect.flatMap(
          sweepAll(options).pipe(Effect.provideService(GitHubBackground, true)),
          (answer) =>
            Object.values(answer).some((swept) => swept === SWEEP_FAILED)
              ? Effect.fail(new SweepsFailed({ answer }))
              : Effect.succeed(answer),
        ),
      )
      .pipe(
        Effect.catch((failure) =>
          failure instanceof SweepsFailed ? Effect.succeed(failure) : Effect.fail(failure),
        ),
      );
    return ran instanceof SweepsFailed
      ? jsonResponse(HOSTED_HTTP_STATUS.INTERNAL_ERROR, ran.answer)
      : jsonResponse(HOSTED_HTTP_STATUS.OK, ran);
  },
);
