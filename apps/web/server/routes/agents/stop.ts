import { codingAgentsApp } from "../../coding-agents-app.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Stops one coding agent (POST): eve's cancel of its turn and the row's stamp; the service's hook stops its sandbox. The logic lives in `server/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({ resolveUserId: resolveHostedUserId, eveOrigin: deploymentEveOrigin }),
);
