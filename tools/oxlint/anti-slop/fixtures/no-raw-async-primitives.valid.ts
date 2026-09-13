import { Effect } from "effect";

/** A delay is the Effect that describes it, interrupted with the fiber holding it. */
export function announceAfter(delayMillis: number, say: () => void): Effect.Effect<void> {
  return Effect.sleep(delayMillis).pipe(Effect.andThen(Effect.sync(say)));
}

/** An injected clock stays an Effect too, never a fallback onto the raw primitive. */
export function announceOn(
  delayMillis: number,
  say: () => void,
  sleep: (delayMs: number) => Effect.Effect<void>,
): Effect.Effect<void> {
  return sleep(delayMillis).pipe(Effect.andThen(Effect.sync(say)));
}
