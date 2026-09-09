import { auth } from "../auth.js";
import { getDatabase } from "../db/index.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "./bearer.js";
import type { BrainV2Options } from "./brain-v2.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "./openai.js";
import { spendHostedMeter } from "./quota.js";

/**
 * The deployment's real seams behind every brain route, built once: the key
 * this deployment holds, its model override, the bearer's account, and the
 * review allowance meter every operation spends. A route file hands its
 * handler here and nothing else.
 */
export function hostedBrainRoute(handle: (options: BrainV2Options) => Promise<Response>) {
  return {
    fetch(request: Request): Promise<Response> {
      return handle({
        request,
        apiKey: process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY],
        model: process.env[HOSTED_OPENAI_ENVIRONMENT.BRAIN_MODEL],
        resolveUserId: (incoming) =>
          hostedUserId(incoming, async (input) =>
            oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
          ),
        spend: (userId) => spendHostedMeter(getDatabase(), { userId, now: Date.now() }),
      });
    },
  };
}
