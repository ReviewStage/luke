import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { codingAgentsApp } from "../../coding-agents-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One coding agent's transcript past a cursor (GET), held open while the agent runs. The logic lives in `server/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
