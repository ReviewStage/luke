import { Effect } from "effect";

/** Executes an Effect only at the behavioral-test edge. */
export function runEffect<Value, Error>(
  effect: Effect.Effect<Value, Error, never>,
): Promise<Value> {
  return Effect.runPromise(effect);
}
