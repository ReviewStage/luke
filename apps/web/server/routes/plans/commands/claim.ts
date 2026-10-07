import { resolveHostedUserId } from "../../../hosted/bearer.js";
import { plansApp } from "../../../plans-app.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** The caller's Mac claiming the next command the planning model asked to run in the plan's folder (POST). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
