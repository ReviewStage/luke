import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One plan's pages, each by its newest version, by the id its path carries (GET). */
export default routeFromHttpRouter(
  plansApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
