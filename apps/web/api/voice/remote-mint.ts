import { eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { getDatabase } from "../../server/db/index.js";
import { providerKey } from "../../server/db/schema.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../server/hosted/openai.js";
import { HOSTED_METER, spendHostedMeter } from "../../server/hosted/quota.js";
import { handleRemoteVoiceMint } from "../../server/hosted/remote-voice-mint.js";

/**
 * Mints one ephemeral Realtime credential for the signed-in iPhone and
 * answers with the user's cloud session roster pre-serialized as a context
 * item. The logic lives in `server/hosted/remote-voice-mint.ts`; this file
 * only hands it the deployment's real seams.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleRemoteVoiceMint({
      request,
      apiKey: process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY],
      model: process.env[HOSTED_OPENAI_ENVIRONMENT.REALTIME_MODEL],
      resolveUserId: (incoming) =>
        hostedUserId(incoming, async (input) =>
          oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
        ),
      spend: (userId) =>
        spendHostedMeter(getDatabase(), {
          userId,
          meter: HOSTED_METER.VOICE_CALL,
          now: Date.now(),
        }),
      encryptionSecret: process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET],
      readVaultKeys: (userId) =>
        getDatabase()
          .select({
            providerId: providerKey.providerId,
            ciphertext: providerKey.ciphertext,
          })
          .from(providerKey)
          .where(eq(providerKey.userId, userId)),
    });
  },
};
