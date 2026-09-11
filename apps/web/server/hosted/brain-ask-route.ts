import type { Route } from "../route.js";
import { runWeb } from "../runtime.js";
import { type BrainAskOptions, handleBrainAsk, handleBrainTurn } from "./brain-ask.js";
import { eveOrigin } from "./brain-host/eve-origin.js";
import { EVE_CALLER, eveSessions } from "./brain-host/eve-sessions.js";
import { askRecord } from "./store/asks.js";
import { hostedStoreRoute } from "./store-route.js";

/**
 * The ask routes as functions: the store route's bearer and store, the one
 * web runner the store and the ask record both stand on, and eve reached on
 * the deployment's own origin as the account whose bearer the request
 * carries. These routes sit beside the store routes rather than in the brain
 * contract's group: that group is gated by the hosted tier's OpenAI key,
 * which must not gate a dispatch to eve.
 */

const asks = askRecord(runWeb);

function brainAskRoute(handler: (options: BrainAskOptions) => Promise<Response>): Route {
  return hostedStoreRoute(({ request, resolveUserId, store }) =>
    handler({
      request,
      resolveUserId,
      store,
      run: runWeb,
      asks,
      eve: (authorization) =>
        eveSessions({
          origin: eveOrigin(new URL(request.url).origin),
          caller: { kind: EVE_CALLER.ACCOUNT, authorization },
        }),
    }),
  );
}

/** `POST /api/brain/ask`. */
export const brainAskRouteHandler: Route = brainAskRoute(handleBrainAsk);

/** `GET /api/brain/turns/{id}`, the path's id rewritten into the query. */
export const brainTurnRouteHandler: Route = brainAskRoute(handleBrainTurn);
