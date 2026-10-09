import { resolveHostedUserId } from "../../../hosted/bearer.js";
import { plansApp } from "../../../plans-app.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/** The caller's Mac posting the board it drew for one claimed look (POST). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
