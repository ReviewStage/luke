import { hostedVoiceMintSeams } from "../../hosted/voice-mint-route.js";
import { routeFromHttpRouter } from "../../route-effect.js";
import { voiceMintApp } from "../../voice-mint-app.js";

/**
 * Mints one ephemeral Realtime credential for the signed-in watch and answers
 * with the user's cloud session roster pre-serialized as a context item. The
 * phone stopped calling it when its voice moved onto the hosted exchange
 * (LUKE-216); the route goes when the watch follows (LUKE-224). The mint
 * lives behind the group in `server/voice-mint-app.ts`; this file only hands
 * it the deployment's real seams.
 */
export default routeFromHttpRouter(voiceMintApp(hostedVoiceMintSeams()));
