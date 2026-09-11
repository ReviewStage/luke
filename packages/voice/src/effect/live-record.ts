/**
 * `LiveRecord` restated as a service, for a caller that reaches for it
 * through `Effect`'s environment rather than the live session service's
 * constructor argument. `../live-session/live-record.js`'s interface is
 * untouched, and so is `LiveSessionService` itself, so this is a second
 * door onto the same value, not a replacement for the first.
 *
 * `liveRecordLayer` is a strangler shim: P7-07 (`compose-live.ts`) is its
 * first real caller, building the plain record in `compose-host.ts` and
 * handing it to the live composer through this tag, but the shim itself
 * stands until `LiveSessionService`'s own constructor reads the tag rather
 * than taking a plain `record` field, a `packages/voice` change beyond a
 * host composer.
 */
import { Context, Layer } from "effect";
import type { LiveRecord } from "../live-session/live-record.js";

export class LiveRecordTag extends Context.Tag("@sidecar/voice/LiveRecord")<
  LiveRecordTag,
  LiveRecord
>() {}

/** @deprecated Wraps the existing record object as a `Layer`; stands until `LiveSessionService`'s constructor reads the tag itself. */
export const liveRecordLayer = (record: LiveRecord): Layer.Layer<LiveRecordTag> =>
  Layer.succeed(LiveRecordTag, record);
