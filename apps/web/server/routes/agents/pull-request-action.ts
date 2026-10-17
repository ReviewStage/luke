import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { codingAgentsApp } from "@luke/service/agents/coding-agents-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One change to a coding agent's pull request (POST), such as marking it ready for review, made on GitHub as the workspace member who asks, on their own GitHub sign-in. The logic lives in `packages/service/src/agents/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
