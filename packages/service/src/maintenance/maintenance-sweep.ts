import type { DatabaseServices } from "@repo/database/core/query";
import { causeKind } from "@repo/runtime/effect";
import { Cause, Clock, Data, Effect, type Redacted } from "effect";
import type { TemplateSweepOutcome } from "../agents/native-sandbox-template.js";
import type { RepositorySnapshotSweepOutcome } from "../agents/repository-snapshot.js";
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
import type { EveSandboxSweepOutcome } from "./eve-sandbox-sweep.js";
import type { NativeSandboxSweepOutcome } from "./native-sandbox-sweep.js";
import type { NativeWakeupSweepOutcome } from "./native-wakeup-sweep.js";
import type { SandboxRetentionSweepOutcome } from "./sandbox-retention-sweep.js";
import type { TerminalLeaseSweepOutcome } from "./terminal-lease-sweep.js";

/**
 * The scheduled sweep: once a minute, Vercel's cron ends what no request
 * will. Each sweep is bounded on its own, and they run in turn, each kept
 * from the others, so one that fails is logged and the rest still run.
 */

type SweepRead<A> = Effect.Effect<A, unknown, DatabaseServices>;

interface MaintenanceSweeps {
  /** Removes every conversation stamped deleted past its retention window, answering how many went. */
  purgeCleared: (now: number) => SweepRead<number>;
  /** Settles every turn still running past its kind's bound, an hour for a brain turn and a day and an hour for a coding agent's, as failed for abandonment, answering how many. */
  sweepAbandonedTurns: (now: number) => SweepRead<number>;
  /** Takes every open launch of the devices that have not beaten within their lease from them, a sweep's worth, its turn ended naming the device. */
  sweepDeviceLeases: (now: number) => SweepRead<DeviceLeaseSweepOutcome>;
  /** Retires the local agents' runners left warm past their device's window, or past its grace on a host waiting to update, a sweep's worth. */
  sweepDeviceWarmRunners: (now: number) => SweepRead<DeviceWarmSweepOutcome>;
  /** Deletes the Vercel Sandboxes of the next eve sessions queued for it, a sweep's worth. */
  sweepSandboxes: (now: number) => SweepRead<SessionSandboxSweepOutcome>;
  /** Stops the coding agents' sandboxes whose terminal lease lapsed past its grace, a sweep's worth. */
  sweepTerminalLeases: (now: number) => SweepRead<TerminalLeaseSweepOutcome>;
  /** Stops the running native agents' sandboxes whose run ended and no terminal holds, a sweep's worth. */
  sweepNativeSandboxes: (now: number) => SweepRead<NativeSandboxSweepOutcome>;
  /** Stops the running eve agents' sandboxes whose turn ended and no terminal holds, a sweep's worth. */
  sweepEveSandboxes: (now: number) => SweepRead<EveSandboxSweepOutcome>;
  /** Bounds the snapshot retention of the stopped agents' sandboxes opened before it was bounded, a bucket's worth. */
  sweepSandboxRetention: (now: number) => SweepRead<SandboxRetentionSweepOutcome>;
  /** Delivers the native agents' wakeups due, a sweep's worth, each as a message from us. */
  sweepNativeWakeups: (now: number) => SweepRead<NativeWakeupSweepOutcome>;
  /** Deletes the withdrawn lines no turn took within a coding agent's turn bound, a sweep's worth, answering how many went. */
  purgeWithdrawnLines: (now: number) => SweepRead<number>;
  /** Fires the automations whose schedule is due, a sweep's worth, each once. */
  sweepAutomations: (now: number) => SweepRead<AutomationSweepOutcome>;
  /** Deletes the plans' pictures uploaded a day or more ago that no save named, a sweep's worth, answering how many went. */
  purgeUnsavedPictures: (now: number) => SweepRead<number>;
  /** Polls the token agents' open pull requests due a poll, a sweep's worth, telling each agent what changed. */
  sweepTokenPullRequests: (now: number) => SweepRead<TokenPullRequestSweepOutcome>;
  /** Moves the native agents' image template on, building it where it is missing, and deletes older images' templates. */
  sweepImageTemplates: (now: number) => SweepRead<TemplateSweepOutcome>;
  /** Deletes the workspaces' repository snapshots past their age, or left unbuilt past their grace. */
  sweepRepositorySnapshots: (now: number) => SweepRead<RepositorySnapshotSweepOutcome>;
  /** Hands on the coding agents' queues standing unpaused whose agent idles, a sweep's worth, answering how many it looked at. */
  sweepAgentQueues: (now: number) => SweepRead<number>;
  /** Deletes the hosts' pairings whose code lapsed, a sweep's worth, and the hosts approved whose boxes never collected their secret, answering how many pairings went. */
  sweepHostPairings: (now: number) => SweepRead<number>;
  /** Prunes the sync log's transactions older than its keep, a sweep's worth, answering how many rows went. */
  pruneSyncLog: (now: number) => SweepRead<number>;
  /** Drops the firewall records of the sandbox sessions past the longest a session runs, answering how many went. */
  purgeStaleFirewalls: (now: number) => SweepRead<number>;
  /** Renews the ChatGPT plan token behind the Codex agents' standing swaps at their sandboxes' firewalls, a window's worth. */
  renewCodexPlanSwaps: (now: number) => SweepRead<CodexPlanSweepOutcome>;
}

/**
 * How a run is told to the sweep's cron monitor: around the sweeps once the
 * call is the cron's own. A call that is not the cron's, or one a
 * deployment without its secret cannot authenticate, is not a run and tells
 * it nothing, so a stranger cannot report a run that failed.
 */
interface SweepMonitor {
  readonly run: <A, E, R>(sweep: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export interface MaintenanceSweepOptions extends MaintenanceSweeps {
  request: Request;
  /** CRON_SECRET, sealed; undefined means the env var is absent or blank and the schedule is off. */
  cronSecret: Redacted.Redacted | undefined;
  monitor: SweepMonitor;
}

interface MaintenanceSweepAnswer {
  /** Deleted conversations purged past their retention window. */
  purged: Swept<number>;
  /** Turns still running past their kind's bound, settled as failed for abandonment. */
  abandoned: Swept<number>;
  deviceLeases: Swept<DeviceLeaseSweepOutcome>;
  deviceWarmRunners: Swept<DeviceWarmSweepOutcome>;
  sandboxes: Swept<SessionSandboxSweepOutcome>;
  terminals: Swept<TerminalLeaseSweepOutcome>;
  nativeSandboxes: Swept<NativeSandboxSweepOutcome>;
  eveSandboxes: Swept<EveSandboxSweepOutcome>;
  sandboxRetention: Swept<SandboxRetentionSweepOutcome>;
  nativeWakeups: Swept<NativeWakeupSweepOutcome>;
  /** Withdrawn lines no turn took in time, deleted. */
  withdrawnLines: Swept<number>;
  automations: Swept<AutomationSweepOutcome>;
  /** Pictures pasted into plans that no save named, deleted. */
  purgedPictures: Swept<number>;
  tokenPullRequests: Swept<TokenPullRequestSweepOutcome>;
  imageTemplates: Swept<TemplateSweepOutcome>;
  repositorySnapshots: Swept<RepositorySnapshotSweepOutcome>;
  /** How many coding agents' queues standing unpaused the sweep looked at, each handed on where its agent idled. */
  agentQueues: Swept<number>;
  /** Hosts' pairings whose code lapsed, deleted. */
  hostPairings: Swept<number>;
  /** Sync log rows older than its keep, pruned. */
  syncLog: Swept<number>;
  /** Firewall records of sandbox sessions long ended, dropped. */
  staleFirewalls: Swept<number>;
  codexPlanSwaps: Swept<CodexPlanSweepOutcome>;
}

/** What a sweep that failed answers in its place: the failure is logged, and the other sweeps run on. */
export const SWEEP_FAILED = { failed: true } as const;

type Swept<A> = A | typeof SWEEP_FAILED;

/** A run in which at least one sweep failed: the cron check-in fails, and the answer still says what every sweep did. */
class SweepsFailed extends Data.TaggedError("SweepsFailed")<{
  readonly answer: MaintenanceSweepAnswer;
}> {}

/**
 * One sweep, kept from the others: a failure or a defect of its own is
 * logged by its kind and answered as `SWEEP_FAILED`, so the sweeps after it
 * still run this minute rather than none of them, every minute, behind one
 * that keeps failing. An interruption, the cron's own deadline, still ends
 * the run.
 */
const isolated = <A>(name: string, sweep: SweepRead<A>): SweepRead<Swept<A>> =>
  sweep.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.as(Effect.logError(`the ${name} sweep failed: ${causeKind(cause)}`), SWEEP_FAILED),
    ),
  );

/** The sweeps in turn, each handed the same instant and each kept from the others (`isolated`). */
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
    terminals: yield* isolated("sweepTerminalLeases", sweeps.sweepTerminalLeases(now)),
    nativeSandboxes: yield* isolated("sweepNativeSandboxes", sweeps.sweepNativeSandboxes(now)),
    eveSandboxes: yield* isolated("sweepEveSandboxes", sweeps.sweepEveSandboxes(now)),
    sandboxRetention: yield* isolated("sweepSandboxRetention", sweeps.sweepSandboxRetention(now)),
    nativeWakeups: yield* isolated("sweepNativeWakeups", sweeps.sweepNativeWakeups(now)),
    withdrawnLines: yield* isolated("purgeWithdrawnLines", sweeps.purgeWithdrawnLines(now)),
    automations: yield* isolated("sweepAutomations", sweeps.sweepAutomations(now)),
    purgedPictures: yield* isolated("purgeUnsavedPictures", sweeps.purgeUnsavedPictures(now)),
    tokenPullRequests: yield* isolated(
      "sweepTokenPullRequests",
      sweeps.sweepTokenPullRequests(now),
    ),
    imageTemplates: yield* isolated("sweepImageTemplates", sweeps.sweepImageTemplates(now)),
    repositorySnapshots: yield* isolated(
      "sweepRepositorySnapshots",
      sweeps.sweepRepositorySnapshots(now),
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

    // Note that a run in which any sweep failed fails its cron check-in, so the monitor still opens
    // an issue on a sweep that keeps failing, while the sweeps after it ran and the answer says which.
    const ran: MaintenanceSweepAnswer | SweepsFailed = yield* options.monitor
      .run(
        // Note that no member waits on a sweep, so what it asks GitHub waits in the background lane (`github-rate-gate.ts`).
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
