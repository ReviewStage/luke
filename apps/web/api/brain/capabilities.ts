import { hostedBrainRoute } from "../../server/hosted/brain-route.js";
import { handleBrainCapabilities } from "../../server/hosted/brain-v2.js";

/**
 * Answers what this deployment's brain contract speaks, for a signed-in
 * client, on the key this deployment holds. The logic lives in
 * `server/hosted/brain-v2.ts`; this file only hands it the deployment's real
 * seams.
 */
export default hostedBrainRoute(handleBrainCapabilities);
