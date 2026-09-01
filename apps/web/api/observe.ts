import { Effect, Layer } from "effect";
import { handleObserve, ObserveCloudFetch } from "../server/hosted/observe.js";
import { ObserveRouteLive } from "../server/layers/route-live.js";
import { getHostedRuntime } from "../server/runtime.js";

/**
 * Observe-on-demand for the signed-in desktop's cloud vault keys. The logic
 * lives in `server/hosted/observe.ts`; this file only enters through the
 * warm-isolate runtime and supplies the vault read seam.
 */
export default {
  fetch(request: Request): Promise<Response> {
    const observeLive = Layer.mergeAll(ObserveRouteLive, Layer.succeed(ObserveCloudFetch, {}));
    return getHostedRuntime().runPromise(Effect.provide(handleObserve(request), observeLive));
  },
};
