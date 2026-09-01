import { handleEvents } from "../server/hosted/events.js";
import { getHostedRuntime } from "../server/runtime.js";

/**
 * Records what the signed-in desktop counted about its own use. The logic
 * lives in `server/hosted/events.ts`; this file only hands it the deployment's
 * real seams through the warm-isolate runtime.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return getHostedRuntime().runPromise(handleEvents(request));
  },
};
