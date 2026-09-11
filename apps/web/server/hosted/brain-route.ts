import { auth } from "../auth.js";
import { unparsedWire, type WireBoundaryInput } from "../core.js";
import { getDatabase } from "../db/index.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer, type UserInfoEndpoint } from "./bearer.js";
import type { BrainV2Options } from "./brain-v2.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "./openai.js";
import { spendHostedMeter } from "./quota.js";

/**
 * The auth service's own userinfo endpoint, read at the hosted API boundary.
 * Every brain route resolves its bearer through this one, whether it is built
 * from the seams below or composed as an `HttpApp`.
 */
export const hostedBrainUserInfo: UserInfoEndpoint = async (input) => {
  // SAFETY: Better Auth hands back its parsed userinfo answer as structured-clone data; the wire guards below validate the selected field.
  const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
  return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
};

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
        resolveUserId: (incoming) => hostedUserId(incoming, hostedBrainUserInfo),
        spend: (userId) => spendHostedMeter(getDatabase(), { userId, now: Date.now() }),
      });
    },
  };
}
