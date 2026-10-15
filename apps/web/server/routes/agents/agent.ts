import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { codingAgentsApp } from "../../coding-agents-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One coding agent's model and effort changed for its next step, or the agent renamed (PATCH). The logic lives in `server/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
