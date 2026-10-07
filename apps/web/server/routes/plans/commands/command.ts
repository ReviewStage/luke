import { resolveHostedUserId } from "../../../hosted/bearer.js";
import { plansApp } from "../../../plans-app.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** The caller's Mac posting what one claimed command answered (POST). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
