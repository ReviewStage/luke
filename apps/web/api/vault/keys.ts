import { Effect } from "effect";
import { handleVaultKeysList } from "../../server/hosted/vault.js";
import { VaultRouteLive } from "../../server/layers/route-live.js";
import { getHostedRuntime } from "../../server/runtime.js";

/**
 * Lists stored provider keys for the signed-in user. The logic lives in
 * `server/hosted/vault.ts`; this file only enters through the warm-isolate
 * runtime and supplies the database read seam.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return getHostedRuntime().runPromise(
      Effect.provide(handleVaultKeysList(request), VaultRouteLive),
    );
  },
};
