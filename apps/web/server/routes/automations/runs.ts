import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { automationsApp } from "../../automations-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** An automation's runs, newest first (GET). The logic lives in `server/automations-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  automationsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
