/**
 * Delegation's lifecycle in Effect's own terms. `children.ts` is a port of
 * OpenClaw `b7528507` and stays faithful to it — it imports nothing from
 * `effect` — so everything Effect needs of it lives here beside it: the
 * service itself as a scoped resource whose start and stop are its acquire
 * and release, the refusals the port already decides as tagged errors
 * carrying its own codes, and the delivery backoff as a `Schedule` composed
 * from the same initial delay and cap the port's formula reads.
 */
import { Data, Duration, Effect, Schedule, type Scope } from "effect";
import type { ChildSpawnReceipt } from "./child-records.js";
import {
  CHILD_DEFAULTS,
  CHILD_SPAWN_REFUSAL,
  type ChildCancellation,
  ChildRunService,
  type ChildRunServiceOptions,
  type ChildSpawnOutcome,
  type ChildSpawnRefusal,
  type ChildSpawnRequest,
} from "./children.js";
import { timersFromRuntime } from "./effect/timers.js";
import type { SessionKey } from "./identifiers.js";

export class ChildSpawnRefused extends Data.TaggedError("ChildSpawnRefused")<{
  readonly code: ChildSpawnRefusal;
  readonly detail?: string;
}> {}

/** A cancel or a reset's cascade left at least one descendant still running. */
export class ChildCancellationIncomplete extends Data.TaggedError("ChildCancellationIncomplete")<{
  readonly remaining: readonly string[];
}> {}

/** Why a completion's retry or dismissal named nothing the service could act on. */
export const CHILD_COMPLETION_REFUSAL = {
  /** No completion for that child is waiting on a retry. */
  NOT_RETRYABLE: "not-retryable",
  /** No completion for that child is blocked, so there is nothing to dismiss. */
  NOT_DISMISSIBLE: "not-dismissible",
} as const;

export type ChildCompletionRefusal =
  (typeof CHILD_COMPLETION_REFUSAL)[keyof typeof CHILD_COMPLETION_REFUSAL];

export class ChildCompletionRefused extends Data.TaggedError("ChildCompletionRefused")<{
  readonly code: ChildCompletionRefusal;
  readonly childId: string;
}> {}

/**
 * OpenClaw's delivery backoff as a cadence: the same initial delay doubling
 * to the same cap the port's `deliveryBackoffMs` computes, stated once so a
 * caller composing its own retry reads the same numbers the live service
 * arms its timers with. `Schedule.map` alone would not do this — it reshapes
 * only the value a driven schedule reports, never the interval it actually
 * waits — so the cap has to be a second schedule the exponential one is
 * `union`-ed with: `union` already recurs on the shorter of the two delays,
 * and `Schedule.as` is what makes the cap's own reported value that same
 * delay rather than `Schedule.spaced`'s default of the recurrence count.
 */
export const childDeliveryBackoffSchedule = (): Schedule.Schedule<Duration.Duration> => {
  const cap = Duration.millis(CHILD_DEFAULTS.DELIVERY_MAXIMUM_BACKOFF_MS);
  return Schedule.exponential(Duration.millis(CHILD_DEFAULTS.DELIVERY_INITIAL_BACKOFF_MS), 2).pipe(
    Schedule.union(Schedule.spaced(cap).pipe(Schedule.as(cap))),
    Schedule.map(([exponential, capped]) => Duration.min(exponential, capped)),
  );
};

export type EffectChildRunServiceOptions = Omit<ChildRunServiceOptions, "schedule" | "cancel">;

/**
 * The live service, armed on the runtime's own `Clock` and owned by a
 * `Scope`: acquiring starts it (loading and recovering what the last launch
 * left) and releasing stops it, disarming every delivery and archive timer
 * so nothing fires after the scope that held it is gone.
 */
export const makeChildRunService = (
  options: EffectChildRunServiceOptions,
): Effect.Effect<ChildRunService, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.flatMap(Effect.runtime<never>(), (runtime) => {
      const timers = timersFromRuntime(runtime);
      const service = new ChildRunService({
        ...options,
        now: timers.now,
        schedule: timers.schedule,
        cancel: timers.cancel,
      });
      return Effect.promise(async () => {
        // A failed load can still have armed some of the record's own
        // archive or delivery timers before it rejected; `acquireRelease`
        // never calls `release` for a failed `acquire`, so this is the one
        // place left to disarm them.
        try {
          await service.start();
        } catch (error) {
          service.stop();
          throw error;
        }
        return service;
      });
    }),
    (service) => Effect.sync(() => service.stop()),
  );

/** Accepts a spawn, or fails with the port's own refusal code and detail. */
export const spawnChild = (
  service: ChildRunService,
  request: ChildSpawnRequest,
): Effect.Effect<ChildSpawnReceipt, ChildSpawnRefused> =>
  Effect.promise(() => service.spawn(request)).pipe(
    Effect.flatMap((outcome: ChildSpawnOutcome) =>
      outcome.accepted
        ? Effect.succeed(outcome.receipt)
        : Effect.fail(
            new ChildSpawnRefused({
              code: outcome.reason,
              ...(outcome.detail !== undefined ? { detail: outcome.detail } : undefined),
            }),
          ),
    ),
  );

const cancellation = (
  outcome: ChildCancellation,
): Effect.Effect<void, ChildCancellationIncomplete> =>
  outcome.ok
    ? Effect.void
    : Effect.fail(new ChildCancellationIncomplete({ remaining: outcome.remaining }));

/** Cancels one child and every descendant of it; fails naming what did not land. */
export const cancelChild = (
  service: ChildRunService,
  childId: string,
): Effect.Effect<void, ChildCancellationIncomplete> =>
  Effect.promise(() => service.cancel(childId)).pipe(Effect.flatMap(cancellation));

/** Cancels every descendant of a conversation, as a reset must before it proceeds. */
export const cancelDescendantsOf = (
  service: ChildRunService,
  requesterSessionKey: SessionKey,
): Effect.Effect<void, ChildCancellationIncomplete> =>
  Effect.promise(() => service.cancelDescendantsOf(requesterSessionKey)).pipe(
    Effect.flatMap(cancellation),
  );

/** Retries a blocked or failed completion's delivery; fails where none is waiting on one. */
export const retryChildDelivery = (
  service: ChildRunService,
  childId: string,
): Effect.Effect<void, ChildCompletionRefused> =>
  Effect.promise(() => service.retryDelivery(childId)).pipe(
    Effect.flatMap((retried) =>
      retried
        ? Effect.void
        : Effect.fail(
            new ChildCompletionRefused({ code: CHILD_COMPLETION_REFUSAL.NOT_RETRYABLE, childId }),
          ),
    ),
  );

/** Lets go of a blocked completion on purpose; fails where none is blocked. */
export const dismissChildCompletion = (
  service: ChildRunService,
  childId: string,
): Effect.Effect<void, ChildCompletionRefused> =>
  Effect.promise(() => service.dismissCompletion(childId)).pipe(
    Effect.flatMap((dismissed) =>
      dismissed
        ? Effect.void
        : Effect.fail(
            new ChildCompletionRefused({ code: CHILD_COMPLETION_REFUSAL.NOT_DISMISSIBLE, childId }),
          ),
    ),
  );

/** The child's own conversation lines, through the executor. */
export const childLines = (
  service: ChildRunService,
  childId: string,
  limit: number,
): Effect.Effect<readonly string[] | undefined> =>
  Effect.promise(() => service.lines(childId, limit));

export { CHILD_SPAWN_REFUSAL };
