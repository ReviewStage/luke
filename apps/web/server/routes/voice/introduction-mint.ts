import { hostedIntroductionMintSeams } from "../../hosted/introduction-mint-route.js";
import { introductionMintApp } from "../../introduction-mint-app.js";
import { routeFromHttpApp } from "../../route-effect.js";

/**
 * Mints the onboarding introduction's one short-lived Realtime credential for
 * a desktop with no account yet, on the key this deployment holds. The mint
 * lives behind the group in `server/introduction-mint-app.ts`; this file only
 * hands it the deployment's real seam.
 */
export default routeFromHttpApp(introductionMintApp(hostedIntroductionMintSeams()));
