import { resolveHostedUserId } from "../../hosted/bearer.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One plan the caller owns, by the id its path carries: open it (GET), rename it (PATCH), or delete it (DELETE). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
