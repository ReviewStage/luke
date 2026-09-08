import { hostedBrainRoute } from "../../../server/hosted/brain-route.js";
import { handleBrainEmbed } from "../../../server/hosted/brain-v2.js";

/**
 * Embeds a batch of notebook chunks for a signed-in client's memory index,
 * on the key this deployment holds. The logic lives in
 * `server/hosted/brain-v2.ts`; this file only hands it the deployment's real
 * seams.
 */
export default hostedBrainRoute(handleBrainEmbed);
