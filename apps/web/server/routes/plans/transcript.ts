import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** What was said on one plan's calls, by the id its path carries (GET). */
export default routeFromHttpRouter(
  plansApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
