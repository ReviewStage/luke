import { auth } from "../../server/auth.js";
import { getDatabase } from "../../server/db/index.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import { handleBrainRespond } from "../../server/hosted/brain-respond.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../server/hosted/openai.js";
import { HOSTED_METER, spendHostedMeter } from "../../server/hosted/quota.js";

/**
 * Runs one inference of Luke's brain for the signed-in desktop, on the key
 * this deployment holds. The logic lives in `server/hosted/brain-respond.ts`;
 * this file only hands it the deployment's real seams. Its function duration
 * is raised in `vercel.json` to outlast the 90-second upstream ceiling, for
 * this route alone.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleBrainRespond({
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
