import type { DatabaseServices } from "@luke/database/core/query";
import { Clock, Effect, type Redacted } from "effect";
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
 * sweep runs them in turn.
 */

/** One sweep of the cron's: a query against the store, so its requirement is the client the edge provides. */
type SweepRead<A> = Effect.Effect<A, unknown, DatabaseServices>;

/** The fourteen sweeps, each answering an Effect over the store's own client the edge provides. */
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
  /** Moves the native agents' image template on, building it where some account connected a plan, and deletes older images' templates. */
  sweepImageTemplates: (now: number) => SweepRead<TemplateSweepOutcome>;
}

/**
 * How a run is told to the sweep's cron monitor: around the fourteen sweeps once
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
  purged: number;
  /** Ended calls of deleted tasks removed. */
  purgedCalls: number;
  /** Turns still running past their kind's bound, settled as failed for abandonment. */
  abandoned: number;
  /** What the sweep over the detached voice sessions did. */
  voice: VoiceOrphanSweepOutcome;
  /** What the sweep over the queued sessions' sandboxes did. */
  sandboxes: SessionSandboxSweepOutcome;
  /** What the sweep over the lapsed terminal leases did. */
  terminals: TerminalLeaseSweepOutcome;
  /** What the sweep over the running native sandboxes did. */
  nativeSandboxes: NativeSandboxSweepOutcome;
  /** What the sweep over the running eve sandboxes did. */
  eveSandboxes: EveSandboxSweepOutcome;
  /** What the delivery of the native agents' wakeups due did. */
  nativeWakeups: NativeWakeupSweepOutcome;
  /** What the wake of the operators whose member's agents failed did. */
  operatorWakes: OperatorWakeSweepOutcome;
  /** What the sweep over the automations due did. */
  automations: AutomationSweepOutcome;
  /** Pictures pasted into plans that no save named, deleted. */
  purgedPictures: number;
  /** What the poll of the token agents' pull requests did. */
  tokenPullRequests: TokenPullRequestSweepOutcome;
  /** What the sweep over the native agents' image templates did. */
  imageTemplates: TemplateSweepOutcome;
}

/** The fourteen sweeps in turn, each handed the same instant. */
const sweepAll = /* @__PURE__ */ Effect.fn("web/sweepAll")(function* (
  sweeps: MaintenanceSweeps,
): Effect.fn.Return<MaintenanceSweepAnswer, unknown, DatabaseServices> {
  const now = yield* Clock.currentTimeMillis;
  return {
    purged: yield* sweeps.purgeCleared(now),
    purgedCalls: yield* sweeps.purgeDeletedTaskCalls(now),
    abandoned: yield* sweeps.sweepAbandonedTurns(now),
    voice: yield* sweeps.sweepVoice(now),
    sandboxes: yield* sweeps.sweepSandboxes(now),
    terminals: yield* sweeps.sweepTerminalLeases(now),
    nativeSandboxes: yield* sweeps.sweepNativeSandboxes(now),
    eveSandboxes: yield* sweeps.sweepEveSandboxes(now),
    nativeWakeups: yield* sweeps.sweepNativeWakeups(now),
    operatorWakes: yield* sweeps.sweepOperatorWakes(now),
    automations: yield* sweeps.sweepAutomations(now),
    purgedPictures: yield* sweeps.purgeUnsavedPictures(now),
    tokenPullRequests: yield* sweeps.sweepTokenPullRequests(now),
    imageTemplates: yield* sweeps.sweepImageTemplates(now),
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

    const answer = yield* options.monitor.run(sweepAll(options));
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  },
);
