import { resolveHostedUserId } from "../hosted/bearer.js";
import { deploymentEveOrigin } from "../hosted/brain-host/eve-origin.js";
import { plansApp } from "../plans-app.js";
import { routeFromHttpRouter } from "../route-effect.js";

/** The account's named plans: list them (GET) or start one (POST). */
export default routeFromHttpRouter(
  plansApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
