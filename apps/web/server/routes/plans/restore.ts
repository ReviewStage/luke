import { resolveHostedUserId } from "../../hosted/bearer.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One revision of a plan put back as its content, by the id and number its path carries (POST). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
