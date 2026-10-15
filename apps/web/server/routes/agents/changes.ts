import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { codingAgentsApp } from "@luke/service/agents/coding-agents-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One coding agent's changes (GET): the files of the pull request it published, as GitHub holds them. The logic lives in `packages/service/src/agents/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
