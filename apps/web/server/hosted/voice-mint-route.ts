import { getDatabase } from "../db/index.js";
import type { VoiceMintSeams } from "../voice-mint-app.js";
import { userIdForAuthorization } from "./bearer.js";
import { spendHostedMeter } from "./quota.js";
import { hostedVaultSeams, hostedVaultUserInfo } from "./vault-route.js";

/**
 * The deployment's real seams behind the signed-in mints: the bearer's
 * account, the day's allowance, and — for the phone's mint alone — the
 * caller's own stored provider keys, read through the same seams every vault
 * route reads them through. The key, the model override, and the vault secret
 * the roster read decrypts those keys with are the environment's, resolved
 * once with the services.
 */
export function hostedVoiceMintSeams(): VoiceMintSeams {
  return {
    resolveUserId: (authorization) => userIdForAuthorization(authorization, hostedVaultUserInfo),
    spend: (userId) => spendHostedMeter(getDatabase(), { userId, now: Date.now() }),
    readVaultKeys: hostedVaultSeams.readVaultKeys,
  };
}
