import { getDatabase } from "../db/index.js";
import type { Route } from "../route.js";
import { runWeb } from "../runtime.js";
import { payloadKeyRing, VAULT_ENCRYPTION_ENVIRONMENT } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";
import { type HostedStore, hostedStore } from "./store/index.js";
import { resolveHostedUserId } from "./vault-route.js";

/**
 * A hosted route over the conversation store: the same bearer resolution
 * every hosted endpoint makes, and the store composed once over the
 * deployment's database under its payload key ring. The ring is what the
 * store's sealed columns open under; a deployment without the secret has
 * no store to read and answers unavailable, the same kill switch the
 * observation tick keeps.
 */
export interface HostedStoreRoute {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  store: HostedStore;
}

let composed: HostedStore | undefined;

function deploymentStore(): HostedStore | undefined {
  if (composed) return composed;
  const secret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET]?.trim();
  if (!secret) return undefined;
  composed = hostedStore({ db: getDatabase(), keys: payloadKeyRing(secret), run: runWeb });
  return composed;
}

export function hostedStoreRoute(handler: (route: HostedStoreRoute) => Promise<Response>): Route {
  return {
    fetch: async (request) => {
      const store = deploymentStore();
      if (!store) {
        return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
      }
      return handler({ request, resolveUserId: resolveHostedUserId, store });
    },
  };
}
