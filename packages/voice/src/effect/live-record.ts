/**
 * `LiveRecord` restated as a service, for a caller that reaches for it
 * through `Effect`'s environment rather than the live session service's
 * constructor argument. `../live-session/live-record.js`'s interface is
 * untouched, and so is `LiveSessionService` itself, so this is a second
 * door onto the same value, not a replacement for the first.
 *
 * `liveRecordLayer` is a strangler shim: P7-07 (compose-speech) deletes it
 * once the host hands the live session service its record as a `Layer`
 * directly, rather than through the constructor argument it stands in for.
 */
import { Context, Layer } from "effect";
import type { LiveRecord } from "../live-session/live-record.js";

export class LiveRecordTag extends Context.Tag("@sidecar/voice/LiveRecord")<
  LiveRecordTag,
  LiveRecord
>() {}

/** @deprecated Wraps the existing record object as a `Layer`; P7-07 deletes it with the constructor argument it stands in for. */
export const liveRecordLayer = (record: LiveRecord): Layer.Layer<LiveRecordTag> =>
  Layer.succeed(LiveRecordTag, record);
