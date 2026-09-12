import type { SqlClient } from "@effect/sql";
import type { Effect } from "effect";
import type { Route } from "../route.js";
import { type BrainAskOptions, handleBrainAsk, handleBrainTurn } from "./brain-ask.js";
import { eveOrigin } from "./brain-host/eve-origin.js";
import { EVE_CALLER, eveSessions } from "./brain-host/eve-sessions.js";
import { askRecord } from "./store/asks.js";
import { hostedStoreRoute } from "./store-route.js";

/**
 * The ask routes as functions: the store route's bearer and store, the ask
 * record over the same ambient client, and eve reached on the deployment's
 * own origin as the account whose bearer the request carries. These routes sit beside the store routes rather than in the brain
 * contract's group: that group is gated by the hosted tier's OpenAI key,
 * which must not gate a dispatch to eve.
 */

const asks = askRecord();

/** An ask route over its handler; a handler that holds more than the ask routes do names it through `widen`. */
export function brainAskRoute<Options extends BrainAskOptions>(
  handler: (options: Options) => Effect.Effect<Response, unknown, SqlClient.SqlClient>,
  widen: (options: BrainAskOptions) => Options,
): Route {
  return hostedStoreRoute(({ request, resolveUserId, store }) =>
    handler(
      widen({
        request,
        resolveUserId,
        store,
        asks,
        eve: (authorization) =>
          eveSessions({
            origin: eveOrigin(new URL(request.url).origin),
            caller: { kind: EVE_CALLER.ACCOUNT, authorization },
          }),
      }),
    ),
  );
}

const asIs = (options: BrainAskOptions): BrainAskOptions => options;

/** `POST /api/brain/ask`. */
export const brainAskRouteHandler: Route = brainAskRoute(handleBrainAsk, asIs);

/** `GET /api/brain/turns/{id}`, the path's id rewritten into the query. */
export const brainTurnRouteHandler: Route = brainAskRoute(handleBrainTurn, asIs);
