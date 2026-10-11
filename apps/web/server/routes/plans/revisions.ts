import { resolveHostedUserId } from "../../hosted/bearer.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A page of a plan's history, newest first, by the id its path carries (GET). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
