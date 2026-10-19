import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { codingAgentsApp } from "@luke/service/agents/coding-agents-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A member's close of one open inbox item without an answer (POST), told to the agent that posted the item where it waits to hear back. The logic lives in `packages/service/src/agents/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
