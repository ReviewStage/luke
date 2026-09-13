/**
 * Delegation's lifecycle in Effect's own terms. `children.ts` is a port of
 * OpenClaw `b7528507` and stays faithful to it — it imports nothing from
 * `effect` — so everything Effect needs of it lives here beside it: the
 * service itself as a scoped resource whose start and stop are its acquire
 * and release, the refusals the port already decides as tagged errors
 * carrying its own codes, the executor and deliverer seams as effects the
 * host writes on its own fiber, and the delivery backoff as a `Schedule`
 * composed from the same initial delay and cap the port's formula reads.
 */
import type { WireRecord } from "@sidecar/wire";
import type { Fiber } from "effect";
import { Cause, Clock, Context, Data, Duration, Effect, Exit, Schedule, type Scope } from "effect";
import type { ChildCompletionRecord, ChildRunRecord, ChildSpawnReceipt } from "./child-records.js";
import {
  CHILD_DEFAULTS,
  CHILD_SPAWN_REFUSAL,
  type ChildCancellation,
  type ChildEnd,
  type ChildExecutor,
  ChildRunService,
  type ChildRunServiceOptions,
  type ChildSpawnOutcome,
  type ChildSpawnRefusal,
  type ChildSpawnRequest,
  type ChildStart,
  type CompletionDeliverer,
  type CompletionDeliveryOutcome,
  type ScheduledTimer,
} from "./children.js";
import type { ExecutionRuntime } from "./execution.js";
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

export type EffectChildRunServiceOptions = Omit<
  ChildRunServiceOptions,
  "now" | "schedule" | "cancel"
>;

/**
 * The `now`/`schedule`/`cancel` triple the port's constructor still takes,
 * answered from the `Clock` the handed services carry, so a service armed on
 * this bridge reads and schedules against that clock — the real one in
 * production, a `TestClock` in a test — without the port itself importing
 * `effect`. Starting the fiber here is a run outside an Effect, which the
 * "runtime only at an edge" rule allows precisely because this is that edge:
 * it starts the work on the services it was handed rather than building a
 * runtime of its own. `cancel` has no way to be awaited, so it interrupts the
 * fiber without waiting for the interruption to finish: what it must
 * guarantee is that the callback does not run afterwards, never that the
 * fiber has already ended.
 */
const timersOnServices = (
  services: Context.Context<never>,
): Pick<ChildRunServiceOptions, "now" | "schedule" | "cancel"> => {
  const sync = Effect.runSyncWith(services);
  const fork = Effect.runForkWith(services);
  const armed = new Map<ScheduledTimer, Fiber.Fiber<void>>();
  return {
    now: () => sync(Clock.currentTimeMillis),
    schedule: (callback, delayMs) => {
      const handle: ScheduledTimer = {};
      const fiber = fork(
        Effect.delay(Effect.sync(callback), Duration.millis(delayMs)).pipe(
          Effect.ensuring(Effect.sync(() => armed.delete(handle))),
        ),
      );
      armed.set(handle, fiber);
      return handle;
    },
    cancel: (timer) => {
      const fiber = armed.get(timer);
      if (fiber === undefined) return;
      armed.delete(timer);
      fiber.interruptUnsafe();
    },
  };
};

/**
 * The live service, armed on the `Clock` its caller's own services carry and
 * owned by a `Scope`: acquiring starts it (loading and recovering what the
 * last launch left) and releasing stops it, disarming every delivery and
 * archive timer so nothing fires after the scope that held it is gone.
 */
export const makeChildRunService = (
  options: EffectChildRunServiceOptions,
): Effect.Effect<ChildRunService, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.flatMap(Effect.context<never>(), (services) => {
      const service = new ChildRunService({ ...options, ...timersOnServices(services) });
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

/** A child's run accepted by its backend, with the effect of its end; or refused, with why. */
export type EffectChildStart =
  | { readonly started: true; readonly done: Effect.Effect<ChildEnd> }
  | { readonly started: false; readonly reason: string };

/** What runs a child, as a host that owns the conversations now writes it: every seam an effect. */
export interface EffectChildExecutor {
  start(
    record: ChildRunRecord,
    fork: readonly WireRecord[] | undefined,
  ): Effect.Effect<EffectChildStart>;
  resume(record: ChildRunRecord): Effect.Effect<EffectChildStart>;
  cancel(record: ChildRunRecord): Effect.Effect<boolean>;
  archive(record: ChildRunRecord): Effect.Effect<boolean>;
  lines(record: ChildRunRecord, limit: number): Effect.Effect<readonly string[]>;
}

/** Hands a completion to the conversation it is for, as an effect of that conversation's own. */
export interface EffectCompletionDeliverer {
  deliver(
    completion: ChildCompletionRecord,
    record: ChildRunRecord,
  ): Effect.Effect<CompletionDeliveryOutcome>;
}

export interface EffectChildSeams {
  readonly executor: EffectChildExecutor;
  readonly deliverer: EffectCompletionDeliverer;
}

/**
 * The executor and deliverer pair the port's constructor takes, over seams
 * their owner writes as effects. The port awaits promises — it imports
 * nothing from `effect` — so each seam is run here, on what the host handed
 * in: the managed runtime it holds, or the bare services its conversations'
 * own fibers carry; this is the one place that carrying happens rather than
 * each seam's own. A defect is squashed back to the error that caused it, so
 * a store or an agent that threw reaches the port's own error handling as the
 * error it threw rather than as the fiber failure that carried it. A `start` answers
 * its end as an effect, and running it is what the port's `done` promise is:
 * the run begins where the port would have begun awaiting it.
 */
export const childSeamsOnRuntime = (
  execution: ExecutionRuntime,
  seams: EffectChildSeams,
): Pick<ChildRunServiceOptions, "executor" | "deliverer"> => {
  const carry = <Value>(effect: Effect.Effect<Value>): Promise<Value> =>
    (Context.isContext(execution)
      ? Effect.runPromiseExitWith(execution)(effect)
      : execution.runPromiseExit(effect)
    ).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw Cause.squash(exit.cause);
    });
  const startOf = (start: EffectChildStart): ChildStart =>
    start.started ? { started: true, done: carry(start.done) } : start;
  const executor: ChildExecutor = {
    start: (record, fork) => carry(seams.executor.start(record, fork)).then(startOf),
    resume: (record) => carry(seams.executor.resume(record)).then(startOf),
    cancel: (record) => carry(seams.executor.cancel(record)),
    archive: (record) => carry(seams.executor.archive(record)),
    lines: (record, limit) => carry(seams.executor.lines(record, limit)),
  };
  const deliverer: CompletionDeliverer = {
    deliver: (completion, record) => carry(seams.deliverer.deliver(completion, record)),
  };
  return { executor, deliverer };
};

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
