import { auth } from "../../../server/auth.js";
import { getDatabase } from "../../../server/db/index.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../../server/hosted/bearer.js";
import { handleBrainRespondV2 } from "../../../server/hosted/brain-v2.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../../server/hosted/openai.js";
import { HOSTED_METER, spendHostedMeter } from "../../../server/hosted/quota.js";

/**
 * Runs one inference of Luke's brain on the second contract, for a
 * signed-in client, on the key this deployment holds. The logic lives in
 * `server/hosted/brain-v2.ts`; this file only hands it the deployment's
 * real seams. It shares the review allowance meter with the first contract.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleBrainRespondV2({
      request,
      apiKey: process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY],
      model: process.env[HOSTED_OPENAI_ENVIRONMENT.BRAIN_MODEL],
      resolveUserId: (incoming) =>
        hostedUserId(incoming, async (input) =>
          oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
        ),
      spend: (userId) =>
        spendHostedMeter(getDatabase(), {
          userId,
          meter: HOSTED_METER.ATTENTION_REVIEW,
          now: Date.now(),
        }),
    });
  },
};
