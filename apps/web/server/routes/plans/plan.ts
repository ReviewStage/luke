import { resolveHostedUserId } from "../../hosted/vault-route.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One plan the caller owns, by the id its path carries: open it (GET) or delete it (DELETE). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
