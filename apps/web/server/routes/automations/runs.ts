import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { automationsApp } from "@luke/service/automations/automations-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** An automation's runs, newest first (GET). The logic lives in `packages/service/src/automations/automations-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  automationsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
