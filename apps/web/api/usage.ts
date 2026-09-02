import { auth } from "../server/auth.js";
import { getDatabase } from "../server/db/index.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../server/hosted/bearer.js";
import { readHostedUsage } from "../server/hosted/quota.js";
import { handleUsage } from "../server/hosted/usage.js";

/**
 * Reads today's hosted counters for the signed-in desktop. The logic lives
 * in `server/hosted/usage.ts`; this file only hands it the deployment's real
 * seams.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleUsage({
      request,
      resolveUserId: (incoming) =>
        hostedUserId(incoming, async (input) =>
          oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
        ),
      readUsage: (userId) => readHostedUsage(getDatabase(), { userId, now: Date.now() }),
    });
  },
};
