import { codingAgentsApp } from "../../coding-agents-app.js";
import { resolveHostedUserId } from "../../hosted/bearer.js";
import { deploymentEveOrigin } from "../../hosted/brain-host/eve-origin.js";
import { harnessFromEnvironment } from "../../hosted/coder-host/harness/compose.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One worker's transcript past a cursor (GET), under the agent and the delegation call that started it, held open while the worker runs. The logic lives in `server/coding-agents-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  codingAgentsApp({
    resolveUserId: resolveHostedUserId,
    eveOrigin: deploymentEveOrigin,
    // SPIKE (do not merge): nothing unless `LUKE_CODER_HARNESS` names a harness.
    harness: harnessFromEnvironment(),
  }),
);
