import { codingAgentsApp } from "../../coding-agents-app.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One coding agent's model and effort changed for its next step (PATCH). The logic lives in `server/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
