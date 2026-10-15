import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { automationsApp } from "@luke/service/automations/automations-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** An automation run now (POST), through its guards and the one start a scheduled run takes. The logic lives in `packages/service/src/automations/automations-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  automationsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
