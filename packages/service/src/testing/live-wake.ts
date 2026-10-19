// live-wake.ts -- the wake a suite's held reads wait on: Realtime scripted to hear no change, so a wait looks on its safety beat alone.
import { type Duration, Effect, Layer } from "effect";
import { LiveWake, type LiveWatch } from "../live/live-wake.js";

/** A watch that hears nothing. */
const QUIET: LiveWatch = { changed: Effect.never };

/**
 * The wake a suite provides where a held read or a wait on a row runs, since
 * the service polls nothing without one: every watch quiet, so a wait looks
 * at once and then on its safety beat, which a suite drives with its clock.
 */
export const quietLiveWake = Layer.succeed(LiveWake, { watch: () => Effect.succeed(QUIET) });

/**
 * The wake a suite on the real clock provides where a wait on a row runs:
 * every watch hears a change each `every`, as Realtime would hear each write
 * the suite makes, so a wait looks again that often.
 */
export function tickingLiveWake(every: Duration.Input) {
  return Layer.succeed(LiveWake, {
    watch: () => Effect.succeed({ changed: Effect.sleep(every) }),
  });
}
