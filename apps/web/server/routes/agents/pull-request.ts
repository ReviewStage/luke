import { codingAgentsApp } from "../../coding-agents-app.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** What one coding agent published (GET): the branch it pushed and the pull request from it, as GitHub holds them. The logic lives in `server/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
