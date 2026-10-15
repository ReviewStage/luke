import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { automationsApp } from "../../automations-app.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One automation: read it (GET), change it (PATCH), or delete it (DELETE). The logic lives in `server/automations-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  automationsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
