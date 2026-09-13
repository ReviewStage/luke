/**
 * `LiveRecord` as `LiveSessionService` takes it: the session reads its record
 * from the context it is built in rather than from a field of its options,
 * so this tag is how a composition states which one it speaks through.
 * `../live-session/live-record.js`'s interface is untouched, and so is every
 * object implementing it, so what this tag changes is where the session
 * looks, not what it finds.
 *
 * `liveRecordLayer` is how a caller that built its record imperatively hands it
 * over: `compose-host.ts` builds the plain one where the brain composer
 * stands and provides it to `compose-live.ts`, and `apps/web`'s hosted
 * exchange provides the one it built beside the service.
 */
import { Context, Layer } from "effect";
import type { LiveRecord } from "../live-session/live-record.js";

export class LiveRecordTag extends Context.Service<LiveRecordTag, LiveRecord>()(
  "@sidecar/voice/LiveRecord",
) {}

/** Hands a record built imperatively to the session that reads `LiveRecordTag`. */
export const liveRecordLayer = (record: LiveRecord): Layer.Layer<LiveRecordTag> =>
  Layer.succeed(LiveRecordTag, record);
