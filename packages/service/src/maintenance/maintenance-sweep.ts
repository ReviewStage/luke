import type { DatabaseServices } from "@luke/database/core/query";
import { Clock, Effect, type Redacted } from "effect";
import type { SessionSandboxSweepOutcome } from "../agents/session-sandboxes.js";
import type { AutomationSweepOutcome } from "../automations/automation-sweep.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";
import type { VoiceOrphanSweepOutcome } from "../voice/orphan-sweep.js";
import type { TerminalLeaseSweepOutcome } from "./terminal-lease-sweep.js";

/**
 * The scheduled sweep: once a minute, Vercel's cron ends what no request
 * will. A plan deleted thirty days ago has its conversation purged, a
 * deleted plan's call that was still open when the plan went is removed
 * once it has ended, a turn whose end eve never told the relay is settled as
 * abandoned, a voice session whose device detached and never came back is
 * ended on Luke's key, as a connection would have ended it, the Vercel
 * Sandboxes of the eve sessions Luke let go of are deleted, a coding agent's
 * sandbox no developer's terminal holds any more is stopped, the
 * automations whose schedule is due are fired, and a picture pasted into a
 * plan a day ago that no save ever named is deleted. None of the eight reads
 * a word of any account; each is bounded on its own, and the sweep runs them
 * in turn.
 */

/** One sweep of the cron's: a query against the store, so its requirement is the client the edge provides. */
type SweepRead<A> = Effect.Effect<A, unknown, DatabaseServices>;

/** The eight sweeps, each answering an Effect over the store's own client the edge provides. */
interface MaintenanceSweeps {
  /** Removes every conversation stamped deleted past its retention window, answering how many went. */
  purgeCleared: (now: number) => SweepRead<number>;
  /** Removes the ended calls of plans deleted since, a sweep's worth, answering how many went. */
  purgeDeletedPlanCalls: (now: number) => SweepRead<number>;
  /** Settles every turn still running past its kind's bound, an hour for a planning turn and a day and an hour for a coding agent's, as failed for abandonment, answering how many. */
  sweepAbandonedTurns: (now: number) => SweepRead<number>;
  /** Ends every voice session whose device socket went without a hang-up longer ago than the grace. */
  sweepVoice: (now: number) => SweepRead<VoiceOrphanSweepOutcome>;
  /** Deletes the Vercel Sandboxes of the next eve sessions queued for it, a sweep's worth. */
  sweepSandboxes: (now: number) => SweepRead<SessionSandboxSweepOutcome>;
  /** Stops the coding agents' sandboxes whose terminal lease lapsed past its grace, a sweep's worth. */
  sweepTerminalLeases: (now: number) => SweepRead<TerminalLeaseSweepOutcome>;
  /** Fires the automations whose schedule is due, a sweep's worth, each once. */
  sweepAutomations: (now: number) => SweepRead<AutomationSweepOutcome>;
  /** Deletes the plans' pictures uploaded a day or more ago that no save named, a sweep's worth, answering how many went. */
  purgeUnsavedPictures: (now: number) => SweepRead<number>;
}

export interface MaintenanceSweepOptions extends MaintenanceSweeps {
  request: Request;
  /** CRON_SECRET, sealed; undefined means the env var is absent or blank and the schedule is off. */
  cronSecret: Redacted.Redacted | undefined;
}

interface MaintenanceSweepAnswer {
  /** Deleted conversations purged past their retention window. */
  purged: number;
  /** Ended calls of deleted plans removed. */
  purgedCalls: number;
  /** Turns still running past their kind's bound, settled as failed for abandonment. */
  abandoned: number;
  /** What the sweep over the detached voice sessions did. */
  voice: VoiceOrphanSweepOutcome;
  /** What the sweep over the queued sessions' sandboxes did. */
  sandboxes: SessionSandboxSweepOutcome;
  /** What the sweep over the lapsed terminal leases did. */
  terminals: TerminalLeaseSweepOutcome;
  /** What the sweep over the automations due did. */
  automations: AutomationSweepOutcome;
  /** Pictures pasted into plans that no save named, deleted. */
  purgedPictures: number;
}

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

    const now = yield* Clock.currentTimeMillis;
    const answer: MaintenanceSweepAnswer = {
      purged: yield* options.purgeCleared(now),
      purgedCalls: yield* options.purgeDeletedPlanCalls(now),
      abandoned: yield* options.sweepAbandonedTurns(now),
      voice: yield* options.sweepVoice(now),
      sandboxes: yield* options.sweepSandboxes(now),
      terminals: yield* options.sweepTerminalLeases(now),
      automations: yield* options.sweepAutomations(now),
      purgedPictures: yield* options.purgeUnsavedPictures(now),
    };
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  },
);
