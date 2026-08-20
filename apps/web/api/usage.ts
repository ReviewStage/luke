import { auth } from "../server/auth";
import { getDatabase } from "../server/db/index";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../server/hosted/bearer";
import { readHostedUsage } from "../server/hosted/quota";
import { handleUsage } from "../server/hosted/usage";

/**
 * Reads today's allowance standing for the signed-in desktop. The logic lives
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
