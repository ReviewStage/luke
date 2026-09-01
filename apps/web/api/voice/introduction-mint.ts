import { Effect } from "effect";
import { handleIntroductionMint } from "../../server/hosted/introduction-mint.js";
import { VoiceMintUpstreamLive } from "../../server/hosted/voice-mint.js";
import { getHostedRuntime } from "../../server/runtime.js";

/**
 * Mints the one credential a fresh install may ask for before any account
 * exists. The logic lives in `server/hosted/introduction-mint.ts`; this file
 * only enters through the warm-isolate runtime.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return getHostedRuntime().runPromise(
      Effect.provide(handleIntroductionMint(request), VoiceMintUpstreamLive),
    );
  },
};
