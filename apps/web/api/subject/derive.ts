import { auth } from "../../server/auth.js";
import { getDatabase } from "../../server/db/index.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../server/hosted/openai.js";
import { HOSTED_METER, spendHostedMeter } from "../../server/hosted/quota.js";
import { handleSubjectDerive } from "../../server/hosted/subject-derive.js";

/**
 * Derives one local session's subject for the signed-in desktop, on the key
 * this deployment holds. The logic lives in `server/hosted/subject-derive.ts`;
 * this file only hands it the deployment's real seams. A derivation spends
 * the attention meter: it is one model call weighed about one session, on
 * the same cadence and the same ceiling.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleSubjectDerive({
      request,
      apiKey: process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY],
      model: process.env[HOSTED_OPENAI_ENVIRONMENT.SUBJECT_MODEL],
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
