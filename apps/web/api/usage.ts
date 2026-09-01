import { handleUsage } from "../server/hosted/usage.js";
import { getHostedRuntime } from "../server/runtime.js";

/**
 * Answers where today's allowance stands for the signed-in desktop. The logic
 * lives in `server/hosted/usage.ts`; this file only enters through the
 * warm-isolate runtime.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return getHostedRuntime().runPromise(handleUsage(request));
  },
};
