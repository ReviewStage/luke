import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { resolveHostedUserId } from "@luke/service/auth/bearer";
import { codingAgentsApp } from "../../coding-agents-app.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One plan's inbox: every item its coding agents posted for the developer, read past a cursor and held open while nothing changed (GET). The logic lives in `server/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
