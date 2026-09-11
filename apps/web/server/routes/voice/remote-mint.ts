import { hostedVoiceMintSeams } from "../../hosted/voice-mint-route.js";
import { routeFromHttpApp } from "../../route-effect.js";
import { voiceMintApp } from "../../voice-mint-app.js";

/**
 * Mints one ephemeral Realtime credential for the signed-in iPhone and
 * answers with the user's cloud session roster pre-serialized as a context
 * item. The mint lives behind the group in `server/voice-mint-app.ts`; this
 * file only hands it the deployment's real seams.
 */
export default routeFromHttpApp(voiceMintApp(hostedVoiceMintSeams()));
