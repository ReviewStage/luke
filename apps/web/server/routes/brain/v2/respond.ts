import { brainApp } from "../../../brain-app.js";
import { hostedBrainSeams } from "../../../hosted/brain-route.js";
import { routeFromHttpApp } from "../../../route-effect.js";

/**
 * Runs one inference of Luke's brain on the hosted brain contract, for a
 * signed-in client, on the key this deployment holds. The contract lives
 * behind the group in `server/brain-app.ts`; this file only hands it the
 * deployment's real seams.
 */
export default routeFromHttpApp(brainApp(hostedBrainSeams()));
