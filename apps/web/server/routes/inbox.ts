import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { codingAgentsApp } from "../coding-agents-app.js";
import { resolveHostedUserId } from "../hosted/bearer.js";
import { routeFromHttpRouter } from "../route-effect.js";

/** What waits on the developer across the account's plans: every open inbox item, read past a cursor and held open while nothing changed (GET). The logic lives in `server/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
