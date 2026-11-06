import { Effect, Fiber } from "effect";

export function onOwnFiber<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.flatMap(Effect.forkDetach(effect), Fiber.join);
}
