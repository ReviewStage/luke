import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

export function runTest<A, E>(effect: Effect.Effect<A, E>): Promise<A>;
export function runTest<A, E, R>(effect: Effect.Effect<A, E, R>, layer: Layer.Layer<R>): Promise<A>;
export function runTest<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R>,
): Promise<A> {
  if (layer === undefined) {
    return Effect.runPromise(effect as Effect.Effect<A, E>);
  }
  return Effect.runPromise(Effect.provide(effect, layer));
}

export const atInstant =
  (millis: number) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provide(Effect.andThen(TestClock.setTime(millis), effect), TestClock.layer());

export const clockAt = (millis: number): Layer.Layer<TestClock.TestClock> =>
  Layer.provideMerge(Layer.effectDiscard(TestClock.setTime(millis)), TestClock.layer());
