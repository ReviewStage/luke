import { resolveHostedUserId } from "../../hosted/bearer.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** What Luke worked on in one plan, a page at a time, and every code he showed on it, by the id its path carries (GET). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
