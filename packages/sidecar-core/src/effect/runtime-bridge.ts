import type { UnknownException } from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";

export function runPromiseExit<A, E>(effect: Effect.Effect<A, E, never>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect);
}

export function runPromiseOrDie<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromise(Effect.orDie(effect));
}

export function fromPromise<A>(
  promise: () => Promise<A>,
): Effect.Effect<A, UnknownException, never> {
  return Effect.tryPromise(promise);
}

export function fromPromiseWithError<A, E>(
  promise: () => Promise<A>,
  mapError: (unknown: unknown) => E,
): Effect.Effect<A, E, never> {
  return Effect.tryPromise({
    try: promise,
    catch: mapError,
  });
}
