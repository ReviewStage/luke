import { Effect } from "effect";
import { handleVaultKeyDelete, handleVaultKeyStore } from "../../server/hosted/vault.js";
import { VaultRouteLive } from "../../server/layers/route-live.js";
import { getHostedRuntime } from "../../server/runtime.js";
import type { HostedServices } from "../../server/services/tags.js";

/**
 * Stores or deletes one provider key in the signed-in user's vault. The logic
 * lives in `server/hosted/vault.ts`; this file only enters through the
 * warm-isolate runtime and supplies the database seams.
 */
export default {
  fetch(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      return getHostedRuntime().runPromise(
        Effect.provide(handleVaultKeyDelete(request), VaultRouteLive) as Effect.Effect<
          Response,
          never,
          HostedServices
        >,
      );
    }
    return getHostedRuntime().runPromise(
      Effect.provide(handleVaultKeyStore(request), VaultRouteLive) as Effect.Effect<
        Response,
        never,
        HostedServices
      >,
    );
  },
};
