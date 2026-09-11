/**
 * `LiveBrain` restated as a service, for a caller that reaches for it
 * through `Effect`'s environment rather than the live session service's
 * constructor argument. `../live-session/live-brain.js`'s interface is
 * untouched, and so is `LiveSessionService` itself, so this is a second
 * door onto the same value, not a replacement for the first.
 *
 * `liveBrainLayer` is a strangler shim: P7-07 (compose-speech) deletes it
 * once the host hands the live session service its brain as a `Layer`
 * directly, rather than through the constructor argument it stands in for.
 */
import { Context, Layer } from "effect";
import type { LiveBrain } from "../live-session/live-brain.js";

export class LiveBrainTag extends Context.Tag("@sidecar/voice/LiveBrain")<
  LiveBrainTag,
  LiveBrain
>() {}

/** @deprecated Wraps the existing brain object as a `Layer`; P7-07 deletes it with the constructor argument it stands in for. */
export const liveBrainLayer = (brain: LiveBrain): Layer.Layer<LiveBrainTag> =>
  Layer.succeed(LiveBrainTag, brain);
