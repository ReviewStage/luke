import { Effect } from "effect";
import { handleVoiceMint, VoiceMintUpstreamLive } from "../../server/hosted/voice-mint.js";
import { getHostedRuntime } from "../../server/runtime.js";

/**
 * Mints one ephemeral Realtime credential for the signed-in desktop, on the
 * key this deployment holds. The logic lives in `server/hosted/voice-mint.ts`;
 * this file only enters through the warm-isolate runtime.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return getHostedRuntime().runPromise(
      Effect.provide(handleVoiceMint(request), VoiceMintUpstreamLive),
    );
  },
};
