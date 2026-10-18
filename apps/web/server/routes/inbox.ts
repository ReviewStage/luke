import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { codingAgentsApp } from "@luke/service/agents/coding-agents-app";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { routeFromHttpRouter } from "../route-effect.js";

/** What waits on the developer across the account's tasks: every open inbox item, read past a cursor and held open while nothing changed (GET). The logic lives in `packages/service/src/agents/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
