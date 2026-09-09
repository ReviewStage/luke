import { getDatabase } from "../../server/db/index.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../server/hosted/openai.js";
import { spendHostedMeter } from "../../server/hosted/quota.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";
import { handleVoiceMint } from "../../server/hosted/voice-mint.js";

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
