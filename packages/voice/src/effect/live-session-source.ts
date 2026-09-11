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
 * strangler shims with no caller yet: every place that holds a source today
 * — `compose-live.ts`'s `account.voiceCapabilities.liveSessions`, the
 * renderer's orchestrator, the desktop main's introduction flow — reads it
 * as a `() => LiveSessionSource | undefined` getter whose answer changes
 * over the run, which a static `Layer.succeed` cannot stand in for, so
 * neither is deleted until a caller with a source fixed once it is built
 * adopts the tag instead.
 */
import { Context, Layer } from "effect";
import type { IntroductionSessionSource, LiveSessionSource } from "../live-session-source.js";

export class LiveSessionSourceTag extends Context.Tag("@sidecar/voice/LiveSessionSource")<
  LiveSessionSourceTag,
  LiveSessionSource
>() {}

/** @deprecated Wraps the existing source object as a `Layer`; stands until a caller with a source fixed once it is built adopts the tag instead of the `source: () => ...` getter. */
export const liveSessionSourceLayer = (
  source: LiveSessionSource,
): Layer.Layer<LiveSessionSourceTag> => Layer.succeed(LiveSessionSourceTag, source);

export class IntroductionSessionSourceTag extends Context.Tag(
  "@sidecar/voice/IntroductionSessionSource",
)<IntroductionSessionSourceTag, IntroductionSessionSource>() {}

/** @deprecated Wraps the existing source object as a `Layer`; stands until a caller with a source fixed once it is built adopts the tag instead of the `source: () => ...` getter. */
export const introductionSessionSourceLayer = (
  source: IntroductionSessionSource,
): Layer.Layer<IntroductionSessionSourceTag> => Layer.succeed(IntroductionSessionSourceTag, source);
