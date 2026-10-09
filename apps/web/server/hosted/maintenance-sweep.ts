import { Clock, Effect, type Redacted } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { VoiceOrphanSweepOutcome } from "../voice/orphan-sweep.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "./http.js";

/**
 * The scheduled sweep: once a minute, Vercel's cron ends what no request
 * will. A plan deleted thirty days ago has its conversation purged, a turn
 * whose end eve never told the relay is settled as abandoned, and a voice
 * session whose device detached and never came back is ended on Luke's key,
 * as a connection would have ended it. None of the three reads a word of any
 * account; each is bounded on its own, and the sweep runs them in turn.
 */

/** One sweep of the cron's: a query against the store, so its requirement is the client the edge provides. */
type SweepRead<A> = Effect.Effect<A, unknown, SqlClient.SqlClient>;

/** The three sweeps, each answering an Effect over the store's own client the edge provides. */
interface MaintenanceSweeps {
  /** Removes every conversation stamped deleted past its retention window, answering how many went. */
  purgeCleared: (now: number) => SweepRead<number>;
  /** Settles every turn still running past its kind's bound, an hour for a planning turn and a day and an hour for a coding agent's, as failed for abandonment, answering how many. */
  sweepAbandonedTurns: (now: number) => SweepRead<number>;
  /** Ends every voice session whose device socket went without a hang-up longer ago than the grace. */
  sweepVoice: (now: number) => SweepRead<VoiceOrphanSweepOutcome>;
}

export interface MaintenanceSweepOptions extends MaintenanceSweeps {
  request: Request;
  /** CRON_SECRET, sealed; undefined means the env var is absent or blank and the schedule is off. */
  cronSecret: Redacted.Redacted | undefined;
}

interface MaintenanceSweepAnswer {
  /** Deleted conversations purged past their retention window. */
  purged: number;
  /** Turns still running past their kind's bound, settled as failed for abandonment. */
  abandoned: number;
  /** What the sweep over the detached voice sessions did. */
  voice: VoiceOrphanSweepOutcome;
}

export const handleMaintenanceSweep = /* @__PURE__ */ Effect.fn("web/handleMaintenanceSweep")(
  function* (
    options: MaintenanceSweepOptions,
  ): Effect.fn.Return<Response, unknown, SqlClient.SqlClient> {
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
      abandoned: yield* options.sweepAbandonedTurns(now),
      voice: yield* options.sweepVoice(now),
    };
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  },
);
