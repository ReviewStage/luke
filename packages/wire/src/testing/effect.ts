import { Effect, type Layer } from "effect";

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
