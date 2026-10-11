import { resolveHostedUserId } from "../../hosted/bearer.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One revision of a plan beside the one before it, by the id and number its path carries (GET). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
