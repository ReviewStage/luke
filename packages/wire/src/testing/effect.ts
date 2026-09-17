import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

/**
 * Runs an Effect to a `Promise` for a test still written on `node:assert`
 * outside `it.effect`, which is what `@effect/vitest` runs for a caller that
 * has moved. A layer supplies the services the Effect needs; an Effect with
 * none takes none.
 */
export function runTest<A, E>(effect: Effect.Effect<A, E>): Promise<A>;
export function runTest<A, E, R>(effect: Effect.Effect<A, E, R>, layer: Layer.Layer<R>): Promise<A>;
export function runTest<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R>,
): Promise<A> {
  if (layer === undefined) {
    // SAFETY: the overload above only permits omitting `layer` when `R` is
    // `never`, so this restores what erasing to one implementation dropped.
    return Effect.runPromise(effect as Effect.Effect<A, E>);
  }
  return Effect.runPromise(Effect.provide(effect, layer));
}

/**
 * Runs an Effect under a `TestClock` set to `millis`, for a test still on a
 * promise runner whose subject reads `Clock`: what used to be handed in as
 * `now: () => millis` is the ambient clock instead. A test on `it.effect`
 * already runs under a `TestClock` and sets its own time.
 */
export const atInstant =
  (millis: number) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provide(Effect.andThen(TestClock.setTime(millis), effect), TestClock.layer());

/** The same clock as a Layer, for a handler a test reaches through a router rather than an Effect. */
export const clockAt = (millis: number): Layer.Layer<TestClock.TestClock> =>
  Layer.provideMerge(Layer.effectDiscard(TestClock.setTime(millis)), TestClock.layer());
