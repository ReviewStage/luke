import { Effect } from "effect";
import { handleAccountDelete } from "../../server/hosted/account-delete.js";
import { AccountDeleteRouteLive } from "../../server/layers/route-live.js";
import { getHostedRuntime } from "../../server/runtime.js";

/**
 * Erases the signed-in desktop's account. The logic lives in
 * `server/hosted/account-delete.ts`; this file only enters through the
 * warm-isolate runtime and supplies the database delete seam.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return getHostedRuntime().runPromise(
      Effect.provide(handleAccountDelete(request), AccountDeleteRouteLive),
    );
  },
};
