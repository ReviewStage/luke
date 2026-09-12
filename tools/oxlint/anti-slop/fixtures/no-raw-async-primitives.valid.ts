import { Effect } from "effect";

/** A delay is the Effect that describes it, interrupted with the fiber holding it. */
export function announceAfter(delayMillis: number, say: () => void): Effect.Effect<void> {
  return Effect.sleep(delayMillis).pipe(Effect.andThen(Effect.sync(say)));
}
