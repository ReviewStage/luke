import type { DatabaseServices } from "@luke/database/core/query";
import { causeKind } from "@luke/runtime/effect";
import { Cause, Clock, Data, Effect, type Redacted } from "effect";
import type { TemplateSweepOutcome } from "../agents/native-sandbox-template.js";
import type { SessionSandboxSweepOutcome } from "../agents/session-sandboxes.js";
import type { AutomationSweepOutcome } from "../automations/automation-sweep.js";
import type { TokenPullRequestSweepOutcome } from "../github/token-pull-request-sweep.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";
import type { VoiceOrphanSweepOutcome } from "../voice/orphan-sweep.js";
import type { EveSandboxSweepOutcome } from "./eve-sandbox-sweep.js";
import type { NativeSandboxSweepOutcome } from "./native-sandbox-sweep.js";
import type { NativeWakeupSweepOutcome } from "./native-wakeup-sweep.js";
import type { OperatorWakeSweepOutcome } from "./operator-wake-sweep.js";
import type { SandboxRetentionSweepOutcome } from "./sandbox-retention-sweep.js";
import type { TerminalLeaseSweepOutcome } from "./terminal-lease-sweep.js";

/**
 * The scheduled sweep: once a minute, Vercel's cron ends what no request
 * will. A task deleted thirty days ago has its conversation purged, a
 * deleted task's call that was still open when the task went is removed
 * once it has ended, a turn whose end eve never told the relay is settled as
 * abandoned, a voice session whose device detached and never came back is
 * ended on Luke's key, as a connection would have ended it, the Vercel
 * Sandboxes of the eve sessions Luke let go of are deleted, a coding agent's
 * sandbox no developer's terminal holds any more is stopped, a native
 * agent's sandbox whose run ended and no terminal holds is stopped where the
 * run's own end did not stop it, an eve agent's sandbox left running with
 * no turn and no terminal to hold it is stopped where its turn's end did
 * not stop it, the wakeups a native agent's released wait left are
 * delivered once due, an operator whose member's agent failed is woken, at
 * most once an hour for each agent, the
 * automations whose schedule is due are fired, a picture pasted into a
 * plan a day ago that no save ever named is deleted, and the pull requests of
 * agents on a member's own GitHub token, which no webhook reaches, are polled
 * for what their agents are told of, and the native agents' image template
 * is moved on and the templates of older images deleted. Each is bounded on its own, and the
 * sweep runs them in turn, each kept from the others, so one that fails is
 * logged and the rest still run.
 */

/** One sweep of the cron's: a query against the store, so its requirement is the client the edge provides. */
type SweepRead<A> = Effect.Effect<A, unknown, DatabaseServices>;

/** The fifteen sweeps, each answering an Effect over the store's own client the edge provides. */
interface MaintenanceSweeps {
  /** Removes every conversation stamped deleted past its retention window, answering how many went. */
  purgeCleared: (now: number) => SweepRead<number>;
  /** Removes the ended calls of tasks deleted since, a sweep's worth, answering how many went. */
  purgeDeletedTaskCalls: (now: number) => SweepRead<number>;
  /** Settles every turn still running past its kind's bound, an hour for a brain turn and a day and an hour for a coding agent's, as failed for abandonment, answering how many. */
  sweepAbandonedTurns: (now: number) => SweepRead<number>;
  /** Ends every voice session whose device socket went without a hang-up longer ago than the grace. */
  sweepVoice: (now: number) => SweepRead<VoiceOrphanSweepOutcome>;
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
  /** Delivers the native agents' wakeups due, a sweep's worth, each as a message from Luke. */
  sweepNativeWakeups: (now: number) => SweepRead<NativeWakeupSweepOutcome>;
  /** Wakes the operators whose member's agents failed with no wake in the hour before, a sweep's worth. */
  sweepOperatorWakes: (now: number) => SweepRead<OperatorWakeSweepOutcome>;
  /** Fires the automations whose schedule is due, a sweep's worth, each once. */
  sweepAutomations: (now: number) => SweepRead<AutomationSweepOutcome>;
  /** Deletes the plans' pictures uploaded a day or more ago that no save named, a sweep's worth, answering how many went. */
  purgeUnsavedPictures: (now: number) => SweepRead<number>;
  /** Polls the token agents' open pull requests due a poll, a sweep's worth, telling each agent what changed. */
  sweepTokenPullRequests: (now: number) => SweepRead<TokenPullRequestSweepOutcome>;
  /** Moves the native agents' image template on, building it where it is missing, and deletes older images' templates. */
  sweepImageTemplates: (now: number) => SweepRead<TemplateSweepOutcome>;
}

/**
 * How a run is told to the sweep's cron monitor: around the fifteen sweeps once
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
  /** Ended calls of deleted tasks removed. */
  purgedCalls: Swept<number>;
  /** Turns still running past their kind's bound, settled as failed for abandonment. */
  abandoned: Swept<number>;
  /** What the sweep over the detached voice sessions did. */
  voice: Swept<VoiceOrphanSweepOutcome>;
  /** What the sweep over the queued sessions' sandboxes did. */
  sandboxes: Swept<SessionSandboxSweepOutcome>;
  /** What the sweep over the lapsed terminal leases did. */
  terminals: Swept<TerminalLeaseSweepOutcome>;
  /** What the sweep over the running native sandboxes did. */
  nativeSandboxes: Swept<NativeSandboxSweepOutcome>;
  /** What the sweep over the running eve sandboxes did. */
  eveSandboxes: Swept<EveSandboxSweepOutcome>;
  /** What the bound on the stopped sandboxes' snapshot retention did. */
  sandboxRetention: Swept<SandboxRetentionSweepOutcome>;
  /** What the delivery of the native agents' wakeups due did. */
  nativeWakeups: Swept<NativeWakeupSweepOutcome>;
  /** What the wake of the operators whose member's agents failed did. */
  operatorWakes: Swept<OperatorWakeSweepOutcome>;
  /** What the sweep over the automations due did. */
  automations: Swept<AutomationSweepOutcome>;
  /** Pictures pasted into plans that no save named, deleted. */
  purgedPictures: Swept<number>;
  /** What the poll of the token agents' pull requests did. */
  tokenPullRequests: Swept<TokenPullRequestSweepOutcome>;
  /** What the sweep over the native agents' image templates did. */
  imageTemplates: Swept<TemplateSweepOutcome>;
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

/** The fifteen sweeps in turn, each handed the same instant and each kept from the others (`isolated`). */
const sweepAll = /* @__PURE__ */ Effect.fn("web/sweepAll")(function* (
  sweeps: MaintenanceSweeps,
): Effect.fn.Return<MaintenanceSweepAnswer, unknown, DatabaseServices> {
  const now = yield* Clock.currentTimeMillis;
  return {
    purged: yield* isolated("purgeCleared", sweeps.purgeCleared(now)),
    purgedCalls: yield* isolated("purgeDeletedTaskCalls", sweeps.purgeDeletedTaskCalls(now)),
    abandoned: yield* isolated("sweepAbandonedTurns", sweeps.sweepAbandonedTurns(now)),
    voice: yield* isolated("sweepVoice", sweeps.sweepVoice(now)),
    sandboxes: yield* isolated("sweepSandboxes", sweeps.sweepSandboxes(now)),
    terminals: yield* isolated("sweepTerminalLeases", sweeps.sweepTerminalLeases(now)),
    nativeSandboxes: yield* isolated("sweepNativeSandboxes", sweeps.sweepNativeSandboxes(now)),
    eveSandboxes: yield* isolated("sweepEveSandboxes", sweeps.sweepEveSandboxes(now)),
    sandboxRetention: yield* isolated("sweepSandboxRetention", sweeps.sweepSandboxRetention(now)),
    nativeWakeups: yield* isolated("sweepNativeWakeups", sweeps.sweepNativeWakeups(now)),
    operatorWakes: yield* isolated("sweepOperatorWakes", sweeps.sweepOperatorWakes(now)),
    automations: yield* isolated("sweepAutomations", sweeps.sweepAutomations(now)),
    purgedPictures: yield* isolated("purgeUnsavedPictures", sweeps.purgeUnsavedPictures(now)),
    tokenPullRequests: yield* isolated(
      "sweepTokenPullRequests",
      sweeps.sweepTokenPullRequests(now),
    ),
    imageTemplates: yield* isolated("sweepImageTemplates", sweeps.sweepImageTemplates(now)),
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
        Effect.flatMap(sweepAll(options), (answer) =>
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
