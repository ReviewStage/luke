import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { codingAgentsApp } from "../../coding-agents-app.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One coding agent's changes (GET): the files of the pull request it published, as GitHub holds them. The logic lives in `server/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
