/**
 * `LiveBrain` as `LiveSessionService` takes it: the session reads its brain
 * from the context it is built in rather than from a field of its options,
 * so this tag is how a composition states which one it speaks through.
 * `../live-session/live-brain.js`'s interface is untouched, and so is every
 * object implementing it, so what this tag changes is where the session
 * looks, not what it finds.
 *
 * `liveBrainLayer` is how a caller that built its brain imperatively hands it
 * over: `compose-host.ts` builds the plain one where the brain composer
 * stands and provides it to `compose-live.ts`, and `apps/web`'s hosted
 * exchange provides the one it built beside the service.
 */
import { Context, Layer } from "effect";
import type { LiveBrain } from "../live-session/live-brain.js";

export class LiveBrainTag extends Context.Tag("@sidecar/voice/LiveBrain")<
  LiveBrainTag,
  LiveBrain
>() {}

/** Hands a brain built imperatively to the session that reads `LiveBrainTag`. */
export const liveBrainLayer = (brain: LiveBrain): Layer.Layer<LiveBrainTag> =>
  Layer.succeed(LiveBrainTag, brain);
