import { automationsApp } from "../../automations-app.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** An automation's runs, newest first (GET). The logic lives in `server/automations-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  automationsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
