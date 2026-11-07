import type { DatabaseServices } from "@repo/database/core/query";
import { causeKind } from "@repo/runtime/effect";
import { Cause, Clock, Data, Effect, type Redacted } from "effect";
import { GitHubBackground } from "../github/github-rate-gate.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";

/**
 * The scheduled sweep: once a minute, Vercel's cron ends what no request
 * will. Each sweep is bounded on its own, and they run in turn, each kept
 * from the others, so one that fails is logged and the rest still run.
 */

type SweepRead<A> = Effect.Effect<A, unknown, DatabaseServices>;

interface MaintenanceSweeps {
  /** Prunes the sync log's transactions older than its keep, a sweep's worth, answering how many rows went. */
  pruneSyncLog: (now: number) => SweepRead<number>;
  /** Closes the shared ports' links no one has visited for their idle bound, holding the rest's sandboxes, answering how many closed. */
  sweepPortShares: (now: number) => SweepRead<number>;
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
  /** Sync log rows older than its keep, pruned. */
  syncLog: Swept<number>;
  /** Shared ports' links closed for going unvisited. */
  portShares: Swept<number>;
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
    syncLog: yield* isolated("pruneSyncLog", sweeps.pruneSyncLog(now)),
    portShares: yield* isolated("sweepPortShares", sweeps.sweepPortShares(now)),
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
