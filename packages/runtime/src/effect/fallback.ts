import { Cause, Effect } from "effect";

export function catchAllButInterrupt<A, E, R, B, E2, R2>(
  effect: Effect.Effect<A, E, R>,
  recover: (cause: Cause.Cause<E>) => Effect.Effect<B, E2, R2>,
): Effect.Effect<A | B, E2, R | R2> {
  return Effect.catchDefect(
    Effect.catch(effect, (error) => recover(Cause.fail(error))),
    (defect) => recover(Cause.die(defect)),
  );
}

export function unlessInterrupted<E, B, E2, R>(
  cause: Cause.Cause<E>,
  onOther: (cause: Cause.Cause<E>) => Effect.Effect<B, E2, R>,
): Effect.Effect<B, E2, R> {
  if (!Cause.hasInterruptsOnly(cause)) return onOther(cause);
  return Effect.failCause(cause as Cause.Cause<never>);
}
