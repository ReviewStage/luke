import { auth } from "../../server/auth";
import { getDatabase } from "../../server/db/index";
import { handleAttentionReview } from "../../server/hosted/attention-review";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../server/hosted/openai";
import { HOSTED_METER, spendHostedMeter } from "../../server/hosted/quota";

/**
 * Reviews one bounded session update for the signed-in desktop, on the key
 * this deployment holds. The logic lives in
 * `server/hosted/attention-review.ts`; this file only hands it the
 * deployment's real seams.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleAttentionReview({
      request,
      apiKey: process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY],
      model: process.env[HOSTED_OPENAI_ENVIRONMENT.ATTENTION_MODEL],
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
