import { handleBrainRespond } from "../../server/hosted/brain-respond.js";
import { hostedBrainRoute } from "../../server/hosted/brain-route.js";

/**
 * Runs one inference of Luke's brain on the first contract, for a signed-in
 * client, on the key this deployment holds. Its function duration is raised in
 * `vercel.json` to outlast the 90-second upstream ceiling. The logic lives in
 * `server/hosted/brain-respond.ts`; this file only hands it the deployment's
 * real seams.
 */
export default hostedBrainRoute(handleBrainRespond);
