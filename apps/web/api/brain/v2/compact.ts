import { hostedBrainRoute } from "../../../server/hosted/brain-route.js";
import { handleBrainCompact } from "../../../server/hosted/brain-v2.js";

/**
 * Compacts one brain context on the hosted brain contract, for a signed-in client,
 * on the key this deployment holds. The logic lives in
 * `server/hosted/brain-v2.ts`; this file only hands it the deployment's real
 * seams.
 */
export default hostedBrainRoute(handleBrainCompact);
