import { Context, Effect, type Layer } from "effect";

/**
 * The `report: (message: string) => void` seam many packages inject, as an
 * Effect service a test can provide instead of a closure over an array: the
 * same collection either way, but reached through `Effect.gen` rather than
 * threaded as a constructor argument.
 */
export class TestReporter extends Context.Tag("@sidecar/wire/testing/TestReporter")<
  TestReporter,
  {
    readonly report: (message: string) => Effect.Effect<void>;
    readonly messages: () => readonly string[];
  }
>() {}

/** A `TestReporter` whose `messages()` answers every `report()` call, in order. */
export const testReporter: Effect.Effect<Context.Tag.Service<typeof TestReporter>> = Effect.sync(
  () => {
    const messages: string[] = [];
    return {
      report: (message) => Effect.sync(() => messages.push(message)),
      messages: () => messages,
    };
  },
);

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
