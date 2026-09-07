import { auth } from "../../../server/auth.js";
import { getDatabase } from "../../../server/db/index.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../../server/hosted/bearer.js";
import { handleBrainCompact } from "../../../server/hosted/brain-v2.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../../server/hosted/openai.js";
import { HOSTED_METER, spendHostedMeter } from "../../../server/hosted/quota.js";

/**
 * Compacts one brain context on the second contract, for a
 * signed-in client, on the key this deployment holds. The logic lives in
 * `server/hosted/brain-v2.ts`; this file only hands it the deployment's
 * real seams. It shares the review allowance meter with the first contract.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleBrainCompact({
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
