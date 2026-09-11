import { brainApp } from "../../../brain-app.js";
import { hostedBrainSeams } from "../../../hosted/brain-route.js";
import { routeFromHttpApp } from "../../../route-effect.js";

/**
 * Embeds a batch of notebook chunks for a signed-in client's memory index,
 * on the key this deployment holds. The contract lives behind the group in
 * `server/brain-app.ts`; this file only hands it the deployment's real seams.
 */
export default routeFromHttpApp(brainApp(hostedBrainSeams()));
