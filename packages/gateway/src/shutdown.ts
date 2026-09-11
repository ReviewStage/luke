/**
 * How the Gateway leaves at an explicit quit, in a fixed order: the door
 * closes to new work, everything under way is cancelled, and the host waits
 * a bounded time for it to settle. What has not settled by then is persisted
 * as unresolved for the next launch's recovery and reported as such: a
 * shutdown never fabricates a completion for work it cut off, and an effect
 * whose outcome the cut left unknown stays unknown.
 */
import { Cause, Duration, Effect, Exit, Ref } from "effect";

export const GATEWAY_SHUTDOWN_DEFAULTS = {
  DEADLINE_MS: 10_000,
} as const;

export interface GatewayShutdownSteps {
  closeAdmissions: () => void;
  /** Cancels everything under way; answers the ids of the runs it asked to stop. */
  cancelActive: () => Promise<readonly string[]>;
  /** Settles once no run is under way, or rejects/hangs, in which case the deadline decides. */
  awaitSettled: (signal: AbortSignal) => Promise<void>;
  /** Writes down whatever did not settle; answers how many records were left for recovery. */
  persistUnresolved: () => Promise<number>;
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
 * settle that hangs is not cancelled itself, only stopped being waited on,
 * same as the deadline it replaces; `persistUnresolved` always runs to
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
    steps.closeAdmissions();
    const controller = new AbortController();
    const cancelledRef = yield* Ref.make<readonly string[]>([]);
    const settledRef = yield* Ref.make(false);
    const work = Effect.gen(function* () {
      const cancelled = yield* Effect.tryPromise({
        try: () => steps.cancelActive(),
        catch: (): readonly string[] => [],
      }).pipe(Effect.merge);
      yield* Ref.set(cancelledRef, cancelled);
      const settled = yield* Effect.tryPromise({
        try: () => steps.awaitSettled(controller.signal),
        catch: () => undefined,
      }).pipe(
        Effect.as(true),
        Effect.catchAll(() => Effect.succeed(false)),
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
    if (timedOut) controller.abort();
    const cancelled = yield* Ref.get(cancelledRef);
    const settled = timedOut ? false : yield* Ref.get(settledRef);
    const unresolved = yield* Effect.promise(() => steps.persistUnresolved());
    return { settled, cancelled, unresolved, elapsedMs: now() - startedAt };
  });
}

/**
 * The Promise-facing door over {@link shutdownGatewayEffect} for the host's
 * coordinator, which still holds a plain async quit rather than a fiber. A
 * step that throws is rethrown exactly as it was raised, the way `await`ing
 * the same steps directly always has, rather than as `Effect.runPromise`'s
 * own `FiberFailure` wrapping: the exit is read and its cause squashed to the
 * one value a step actually threw.
 *
 * @deprecated Strangler shim over {@link shutdownGatewayEffect}; P7-10 (the
 * drain) composes the host's quit as an effect directly and deletes this door.
 */
export async function shutdownGateway(
  steps: GatewayShutdownSteps,
  options: GatewayShutdownOptions = {},
): Promise<GatewayShutdownReport> {
  const exit = await Effect.runPromiseExit(shutdownGatewayEffect(steps, options));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}
