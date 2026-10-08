import { resolveHostedUserId } from "../../hosted/bearer.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One plan's whiteboard, by the id its path carries: read it (GET) or write the developer's scene (PUT). */
export default routeFromHttpRouter(plansApp({ resolveUserId: resolveHostedUserId }));
