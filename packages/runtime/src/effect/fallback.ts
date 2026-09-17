/**
 * fallback.ts -- recovering from a failure or a defect while an interruption passes through.
 *
 * A read that failed or defected stands as its fallback; a caller ending the
 * fiber is neither, so what is handled here is the typed failure and the
 * unexpected throw, never the cause whole: `Effect.catchCause` would take an
 * interruption with them and a fiber that was told to stop would go on. A
 * caller already holding a cause asks `unlessInterrupted` the same question.
 */
import { Cause, Effect } from "effect";

/**
 * Recovers from a failure or a defect, handing `recover` the cause it came as,
 * and lets an interruption end the fiber untouched.
 */
export function catchAllButInterrupt<A, E, R, B, E2, R2>(
  effect: Effect.Effect<A, E, R>,
  recover: (cause: Cause.Cause<E>) => Effect.Effect<B, E2, R2>,
): Effect.Effect<A | B, E2, R | R2> {
  return Effect.catchDefect(
    Effect.catch(effect, (error) => recover(Cause.fail(error))),
    (defect) => recover(Cause.die(defect)),
  );
}

/** A failure or a defect answered with `fallback`; an interruption passes through. */
export function withFallback<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  fallback: A,
): Effect.Effect<A, never, R> {
  return catchAllButInterrupt(effect, () => Effect.succeed(fallback));
}

/**
 * For a caller inside `Effect.catchCause` that needs the cause itself: an
 * interruption is re-raised as it came, and anything else is `onOther`'s.
 */
export function unlessInterrupted<E, B, E2, R>(
  cause: Cause.Cause<E>,
  onOther: (cause: Cause.Cause<E>) => Effect.Effect<B, E2, R>,
): Effect.Effect<B, E2, R> {
  if (!Cause.hasInterruptsOnly(cause)) return onOther(cause);
  // SAFETY: a cause of interruptions only carries no failure, so re-raising it cannot join the typed failure channel.
  return Effect.failCause(cause as Cause.Cause<never>);
}
