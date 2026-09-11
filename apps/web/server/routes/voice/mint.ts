import { getDatabase } from "../../db/index.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../hosted/openai.js";
import { spendHostedMeter } from "../../hosted/quota.js";
import { hostedVaultRoute } from "../../hosted/vault-route.js";
import { handleVoiceMint } from "../../hosted/voice-mint.js";

/**
 * Mints one ephemeral Realtime credential for the signed-in desktop, on the
 * key this deployment holds. The logic lives in `server/hosted/voice-mint.ts`;
 * this file only hands it the deployment's real seams.
 */
export default hostedVaultRoute((route) =>
  handleVoiceMint({
    ...route,
    apiKey: process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY],
    model: process.env[HOSTED_OPENAI_ENVIRONMENT.REALTIME_MODEL],
    spend: (userId) => spendHostedMeter(getDatabase(), { userId, now: Date.now() }),
  }),
);
