import { Effect } from "effect";

/** Runs an effect whose typed failure channel is empty as a Promise; defects reject. */
export function fromPromise<A>(effect: Effect.Effect<A, never, never>): Promise<A> {
  return Effect.runPromise(effect);
}
