/**
 * own-fiber.ts -- an effect run on a fiber of its own, joined from inside an uninterruptible region.
 *
 * An uninterruptible region is one nothing inside it may interrupt either,
 * including a deadline raced against the request it bounds, which would then
 * never win and never end a hung call. The effect is forked as a daemon, and
 * a fork is interruptible whatever the status of the fiber that made it, so
 * its own deadline ends it exactly as it did on a fiber of its own, while
 * the caller still waits for what it asked for.
 */
import { Effect, Fiber } from "effect";

/** `effect` on a detached fiber, its answer joined back into the caller. */
export function onOwnFiber<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.flatMap(Effect.forkDetach(effect), Fiber.join);
}
