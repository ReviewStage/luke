/**
 * effect-services.ts -- hands `@repo/ui`'s edge the services a test runs on, a `TestClock` among them, until the test finishes.
 *
 * Every fiber the library forks after this runs on `services`
 * (`ui-runtime.ts`), so a tick or a wait moves as the test moves its clock.
 * The empty context goes back as the test finishes, pass or fail, so no
 * test leaks its clock into the next.
 */

import { type Clock, Context, type Duration, Effect } from "effect";
import { onTestFinished } from "vitest";
import { effectServices } from "../ui-runtime.js";

/**
 * A clock that reads the time as the process does and never wakes a sleep,
 * for a test that runs every fake timer out while a working mark stands,
 * whose beat would otherwise arm a timer on every one it runs.
 */
export const STILL_CLOCK: Clock.Clock = {
  currentTimeMillisUnsafe: () => Date.now(),
  currentTimeMillis: Effect.sync(() => Date.now()),
  currentTimeNanosUnsafe: () => BigInt(Date.now()) * 1_000_000n,
  currentTimeNanos: Effect.sync(() => BigInt(Date.now()) * 1_000_000n),
  monotonicTimeNanosUnsafe: () => BigInt(Date.now()) * 1_000_000n,
  monotonicTimeNanos: Effect.sync(() => BigInt(Date.now()) * 1_000_000n),
  sleep: (_duration: Duration.Duration) => Effect.never,
};

/** Runs the library's fibers on `services` until the calling test finishes. */
export function serveEffectsOn(services: Context.Context<never>): void {
  effectServices.setState(() => services);
  onTestFinished(() => effectServices.setState(() => Context.empty()));
}
