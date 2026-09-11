import { hostedBrainRoute } from "../../../hosted/brain-route.js";
import { handleBrainRespondV2 } from "../../../hosted/brain-v2.js";

/**
 * Runs one inference of Luke's brain on the hosted brain contract, for a signed-in
 * client, on the key this deployment holds. The logic lives in
 * `server/hosted/brain-v2.ts`; this file only hands it the deployment's real
 * seams.
 */
export default hostedBrainRoute(handleBrainRespondV2);
