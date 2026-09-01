import { handleAttentionReview } from "../../server/hosted/attention-review.js";
import { getHostedRuntime } from "../../server/runtime.js";

/**
 * Reviews one bounded session update on Luke's own key for a signed-in user.
 * The logic lives in `server/hosted/attention-review.ts`; this file only
 * enters through the warm-isolate runtime.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return getHostedRuntime().runPromise(handleAttentionReview(request));
  },
};
