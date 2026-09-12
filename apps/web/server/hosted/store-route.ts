import type { Route } from "../route.js";
import { runWeb } from "../runtime.js";
import { payloadKeyRing } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";
import type { HostedStoreRun } from "./store/database.js";
import { type HostedStore, hostedStore } from "./store/index.js";
import { hostedEncryptionSecret, resolveHostedUserId } from "./vault-route.js";

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
  /** The runner this deployment's edge answers the store's effects through. */
  run: HostedStoreRun;
  store: HostedStore;
}

let composed: HostedStore | undefined;

async function deploymentStore(): Promise<HostedStore | undefined> {
  if (composed) return composed;
  const secret = await hostedEncryptionSecret();
  if (!secret) return undefined;
  composed = hostedStore({ keys: payloadKeyRing(secret) });
  return composed;
}

export function hostedStoreRoute(handler: (route: HostedStoreRoute) => Promise<Response>): Route {
  return {
    fetch: async (request) => {
      const store = await deploymentStore();
      if (!store) {
        return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
      }
      return handler({ request, resolveUserId: resolveHostedUserId, run: runWeb, store });
    },
  };
}
