import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One version of one page of a plan, with its HTML, by the ids and number its path carries (GET). */
export default routeFromHttpRouter(
  plansApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
