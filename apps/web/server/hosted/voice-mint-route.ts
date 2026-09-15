import type { VoiceMintSeams } from "../voice-mint-app.js";
import { userIdForAuthorization } from "./bearer.js";
import { spendHostedMeter } from "./quota.js";
import { hostedVaultUserInfo } from "./vault-route.js";

/**
 * The deployment's real seams behind the signed-in mint: the bearer's account
 * and the day's allowance. The key and the model override are the
 * environment's, resolved once with the services.
 */
export function hostedVoiceMintSeams(): VoiceMintSeams {
  return {
    resolveUserId: (authorization) => userIdForAuthorization(authorization, hostedVaultUserInfo),
    spend: (userId) => spendHostedMeter({ userId, now: Date.now() }),
  };
}
