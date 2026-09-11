/**
 * `LiveSessionSource` and `IntroductionSessionSource` restated as services,
 * for a caller that reaches for one through `Effect`'s environment rather
 * than a constructor argument. `../live-session-source.js`'s interfaces are
 * untouched, and so is every concrete source that already implements them —
 * `KeyedLiveSessionSource`, `HostedLiveSessionSource`,
 * `IntroductionLiveSessionSource` — so this is a second door onto the same
 * value, not a replacement for the first.
 *
 * `liveSessionSourceLayer` and `introductionSessionSourceLayer` are
 * strangler shims: P7-07 (compose-speech) deletes them once the host hands
 * the orchestrator and the live session service their source as a `Layer`
 * directly, rather than through the `source: () => LiveSessionSource |
 * undefined` constructor argument they stand in for.
 */
import { Context, Layer } from "effect";
import type { IntroductionSessionSource, LiveSessionSource } from "../live-session-source.js";

export class LiveSessionSourceTag extends Context.Tag("@sidecar/voice/LiveSessionSource")<
  LiveSessionSourceTag,
  LiveSessionSource
>() {}

/** @deprecated Wraps the existing source object as a `Layer`; P7-07 deletes it with the constructor argument it stands in for. */
export const liveSessionSourceLayer = (
  source: LiveSessionSource,
): Layer.Layer<LiveSessionSourceTag> => Layer.succeed(LiveSessionSourceTag, source);

export class IntroductionSessionSourceTag extends Context.Tag(
  "@sidecar/voice/IntroductionSessionSource",
)<IntroductionSessionSourceTag, IntroductionSessionSource>() {}

/** @deprecated Wraps the existing source object as a `Layer`; P7-07 deletes it with the constructor argument it stands in for. */
export const introductionSessionSourceLayer = (
  source: IntroductionSessionSource,
): Layer.Layer<IntroductionSessionSourceTag> => Layer.succeed(IntroductionSessionSourceTag, source);
