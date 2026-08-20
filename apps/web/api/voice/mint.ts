import { auth } from "../../server/auth";
import { getDatabase } from "../../server/db/index";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../server/hosted/openai";
import { HOSTED_METER, spendHostedMeter } from "../../server/hosted/quota";
import { handleVoiceMint } from "../../server/hosted/voice-mint";

/**
 * Mints one ephemeral Realtime credential for the signed-in desktop, on the
 * key this deployment holds. The logic lives in `server/hosted/voice-mint.ts`;
 * this file only hands it the deployment's real seams.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleVoiceMint({
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
    });
  },
};
