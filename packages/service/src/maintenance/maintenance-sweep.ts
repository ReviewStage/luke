import type { DatabaseServices } from "@repo/database/core/query";
import { causeKind } from "@repo/runtime/effect";
import { Cause, Clock, Data, Effect, type Redacted } from "effect";
import type { TemplateSweepOutcome } from "../agents/native-sandbox-template.js";
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

/**
 * The scheduled sweep: once a minute, Vercel's cron ends what no request
 * will. A task deleted seven days ago has its conversation purged, a
 * turn whose end eve never told the relay is settled as
 * abandoned, a local agent's open run is taken from a device that stopped
 * beating for its lease, its turn ended naming the device, a local agent's
 * runner left warm past its device's window is retired, the Vercel
 * Sandboxes of the eve sessions we let go of are deleted, a native agent's
 * turn whose runner died mid-turn is settled as failed, the wakeups a native agent's released wait left are
 * delivered once due, a developer's line whose hand-over
 * answered nothing and that no turn took within a coding agent's turn
 * bound is deleted, the automations whose schedule is due are fired, a picture pasted into a
 * plan a day ago that no save ever named is deleted, and the pull requests of
 * agents on a member's own GitHub token, which no webhook reaches, are polled
 * for what their agents are told of, and the native agents' image template
 * is moved on and the templates of older images deleted, the hosts' pairings
 * whose code lapsed are deleted with the address each kept, the sync log's
 * rows older than its keep are pruned, the firewall records of sandbox
 * sessions that ended long since are dropped, and the ChatGPT plan token a
 * Codex agent's sandbox carries at its firewall is renewed before it lapses.
 * Each is bounded on its own, and the
 * sweep runs them in turn, each kept from the others, so one that fails is
 * logged and the rest still run.
 */

/** One sweep of the cron's: a query against the store, so its requirement is the client the edge provides. */
type SweepRead<A> = Effect.Effect<A, unknown, DatabaseServices>;

/** The seventeen sweeps, each answering an Effect over the store's own client the edge provides. */
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
  /** Stops the running native agents' sandboxes whose run ended and no terminal holds, a sweep's worth. */
  sweepNativeSandboxes: (now: number) => SweepRead<NativeSandboxSweepOutcome>;
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
 * How a run is told to the sweep's cron monitor: around the seventeen sweeps once
 * the call is the cron's own. A call that is not the cron's, or one a
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
  /** What the sweep over the devices whose lease lapsed did. */
  deviceLeases: Swept<DeviceLeaseSweepOutcome>;
  /** What the sweep over the local agents' warm runners did. */
  deviceWarmRunners: Swept<DeviceWarmSweepOutcome>;
  /** What the sweep over the queued sessions' sandboxes did. */
  sandboxes: Swept<SessionSandboxSweepOutcome>;
  /** What the sweep over the running native sandboxes did. */
  nativeSandboxes: Swept<NativeSandboxSweepOutcome>;
  /** What the delivery of the native agents' wakeups due did. */
  nativeWakeups: Swept<NativeWakeupSweepOutcome>;
  /** Withdrawn lines no turn took in time, deleted. */
  withdrawnLines: Swept<number>;
  /** What the sweep over the automations due did. */
  automations: Swept<AutomationSweepOutcome>;
  /** Pictures pasted into plans that no save named, deleted. */
  purgedPictures: Swept<number>;
  /** What the poll of the token agents' pull requests did. */
  tokenPullRequests: Swept<TokenPullRequestSweepOutcome>;
  /** What the sweep over the native agents' image templates did. */
  imageTemplates: Swept<TemplateSweepOutcome>;
  /** How many coding agents' queues standing unpaused the sweep looked at, each handed on where its agent idled. */
  agentQueues: Swept<number>;
  /** Hosts' pairings whose code lapsed, deleted. */
  hostPairings: Swept<number>;
  /** Sync log rows older than its keep, pruned. */
  syncLog: Swept<number>;
  /** Firewall records of sandbox sessions long ended, dropped. */
  staleFirewalls: Swept<number>;
  /** What the renewal of the Codex agents' plan tokens at their firewalls did. */
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

/** The seventeen sweeps in turn, each handed the same instant and each kept from the others (`isolated`). */
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
    imageTemplates: yield* isolated("sweepImageTemplates", sweeps.sweepImageTemplates(now)),
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
