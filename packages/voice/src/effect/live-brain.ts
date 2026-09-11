/**
 * `LiveBrain` restated as a service, for a caller that reaches for it
 * through `Effect`'s environment rather than the live session service's
 * constructor argument. `../live-session/live-brain.js`'s interface is
 * untouched, and so is `LiveSessionService` itself, so this is a second
 * door onto the same value, not a replacement for the first.
 *
 * `liveBrainLayer` is a strangler shim: P7-07 (`compose-live.ts`) is its
 * first real caller, building the plain brain in `compose-host.ts` and
 * handing it to the live composer through this tag, but the shim itself
 * stands until `LiveSessionService`'s own constructor reads the tag rather
 * than taking a plain `brain` field, a `packages/voice` change beyond a
 * host composer.
 */
import { Context, Layer } from "effect";
import type { LiveBrain } from "../live-session/live-brain.js";

export class LiveBrainTag extends Context.Tag("@sidecar/voice/LiveBrain")<
  LiveBrainTag,
  LiveBrain
>() {}

/** @deprecated Wraps the existing brain object as a `Layer`; stands until `LiveSessionService`'s constructor reads the tag itself. */
export const liveBrainLayer = (brain: LiveBrain): Layer.Layer<LiveBrainTag> =>
  Layer.succeed(LiveBrainTag, brain);
