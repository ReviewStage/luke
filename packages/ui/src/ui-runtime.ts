/**
 * ui-runtime.ts -- the one place `@repo/ui` runs an Effect: the services its timers fork on, and the fork.
 *
 * Every wait and tick in the library (`wait.ts`) forks here, on the
 * services `effectServices` holds when the fork is taken. No service stands
 * by default, so a fiber runs on the real clock; a test hands it a
 * `TestClock` by setting the store to a context holding one, and puts the
 * empty one back after, so the ticks it reads move as the test moves time.
 * A fiber already running keeps the services it started on.
 *
 * Note that the services are a TanStack `Store` rather than a runtime of
 * our own, because there is nothing to build: the store is the seam a test
 * reaches, and a fork reads it as it is taken.
 */

import { Store } from "@tanstack/react-store";
import { Context, Effect } from "effect";

/** The services every fiber the library forks runs on: none, so the real clock, unless a test hands it one. */
export const effectServices = new Store<Context.Context<never>>(Context.empty());

/**
 * Runs `effect` as a fiber of its own on `effectServices`, and answers the
 * way to interrupt it, which returns without waiting on its finalizers, as a
 * React cleanup must.
 */
export function forkEffect(effect: Effect.Effect<void>): () => void {
  const fiber = Effect.runForkWith(effectServices.state)(effect);
  return () => fiber.interruptUnsafe();
}
