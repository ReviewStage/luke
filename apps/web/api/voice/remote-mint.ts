import { getDatabase } from "../../server/db/index.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../server/hosted/openai.js";
import { spendHostedMeter } from "../../server/hosted/quota.js";
import { handleRemoteVoiceMint } from "../../server/hosted/remote-voice-mint.js";
import { hostedVaultRoute } from "../../server/hosted/vault-route.js";

/**
 * Mints one ephemeral Realtime credential for the signed-in iPhone and
 * answers with the user's cloud session roster pre-serialized as a context
 * item. The logic lives in `server/hosted/remote-voice-mint.ts`; this file
 * only hands it the deployment's real seams.
 */
export default hostedVaultRoute((route) =>
  handleRemoteVoiceMint({
    ...route,
    apiKey: process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY],
    model: process.env[HOSTED_OPENAI_ENVIRONMENT.REALTIME_MODEL],
    spend: (userId) => spendHostedMeter(getDatabase(), { userId, now: Date.now() }),
  }),
);
