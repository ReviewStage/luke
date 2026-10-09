import { resolveHostedUserId } from "../../../hosted/bearer.js";
import { plansApp } from "../../../plans-app.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** The caller's Mac claiming the next look at the plan's board the planning model asked for (POST). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
