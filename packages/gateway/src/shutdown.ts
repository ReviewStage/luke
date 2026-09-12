/**
 * How the Gateway leaves at an explicit quit, in a fixed order: the door
 * closes to new work, everything under way is cancelled, and the host waits
 * a bounded time for it to settle. What has not settled by then is persisted
 * as unresolved for the next launch's recovery and reported as such: a
 * shutdown never fabricates a completion for work it cut off, and an effect
 * whose outcome the cut left unknown stays unknown.
 */
import { Duration, Effect, Ref } from "effect";

export const GATEWAY_SHUTDOWN_DEFAULTS = {
  DEADLINE_MS: 10_000,
} as const;

export interface GatewayShutdownSteps {
  readonly closeAdmissions: Effect.Effect<void>;
  /** Cancels everything under way; answers the ids of the runs it asked to stop. */
  readonly cancelActive: Effect.Effect<readonly string[]>;
  /** Settles once no run is under way, or dies/hangs, in which case the deadline decides. */
  readonly awaitSettled: Effect.Effect<void>;
  /** Writes down whatever did not settle; answers how many records were left for recovery. */
  readonly persistUnresolved: Effect.Effect<number>;
}

export interface GatewayShutdownOptions {
  deadlineMs?: number;
  now?: () => number;
}

export interface GatewayShutdownReport {
  /** Whether every run under way settled before the deadline. */
  settled: boolean;
  cancelled: readonly string[];
  /** How many records were persisted unresolved for recovery. */
  unresolved: number;
  elapsedMs: number;
}

/**
 * One deadline covers the cancellation and the settling both: a cancel that
 * hangs on a store or a run is as unbounded as a run that never settles, and
 * either leaves the Gateway standing past its quit. The two steps run in
 * sequence inside the one bound, so a cancellation that spends most of the
 * deadline leaves settling little of it, exactly as a shared clock would;
 * whichever step the bound lands inside, what the step before it already
 * produced stands — a `Ref` neither step's own interruption can take back —
 * and the step that was cut is counted as never having settled. A cancel or a
 * settle that hangs is interrupted where it waits rather than at the work
 * beneath it, which is the abort signal this bound used to hand the settling
 * step; `persistUnresolved` always runs to
 * completion, whatever the deadline decided, because recovery must never be
 * the thing a cut shutdown also drops.
 */
export function shutdownGatewayEffect(
  steps: GatewayShutdownSteps,
  options: GatewayShutdownOptions = {},
): Effect.Effect<GatewayShutdownReport> {
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS;
  return Effect.gen(function* () {
    const startedAt = now();
    yield* steps.closeAdmissions;
    const cancelledRef = yield* Ref.make<readonly string[]>([]);
    const settledRef = yield* Ref.make(false);
    const work = Effect.gen(function* () {
      // A step that died is the coordinator's to absorb rather than to carry
      // out of the quit: a cancellation nobody counted and a settling nobody
      // saw are what the report already says of a step the deadline cut.
      const cancelled = yield* steps.cancelActive.pipe(
        Effect.catchAllDefect(() => Effect.succeed<readonly string[]>([])),
      );
      yield* Ref.set(cancelledRef, cancelled);
      const settled = yield* steps.awaitSettled.pipe(
        Effect.as(true),
        Effect.catchAllDefect(() => Effect.succeed(false)),
      );
      yield* Ref.set(settledRef, settled);
    });
    const timedOut = yield* work.pipe(
      Effect.timeoutTo({
        duration: Duration.millis(deadlineMs),
        onTimeout: () => true,
        onSuccess: () => false,
      }),
    );
    const cancelled = yield* Ref.get(cancelledRef);
    const settled = timedOut ? false : yield* Ref.get(settledRef);
    const unresolved = yield* steps.persistUnresolved;
    return { settled, cancelled, unresolved, elapsedMs: now() - startedAt };
  });
}
