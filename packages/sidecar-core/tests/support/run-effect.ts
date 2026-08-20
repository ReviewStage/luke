import { Effect } from "effect";

export function runTestEffect<A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> {
  // SAFETY: Sidecar-core tests run effects whose requirements are already satisfied by fixtures.
  return Effect.runPromise(effect as Effect.Effect<A, E, never>);
}
