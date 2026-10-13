import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { plansApp } from "../../plans-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** The developer's edit of the document of a plan the caller owns, by the id its path carries (POST). */
export default routeFromHttpRouter(
  plansApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
