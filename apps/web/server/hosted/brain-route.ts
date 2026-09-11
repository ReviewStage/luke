import { auth } from "../auth.js";
import type { BrainSeams } from "../brain-app.js";
import { unparsedWire, type WireBoundaryInput } from "../core.js";
import { runWeb } from "../runtime.js";
import {
  oauthUserInfoFromAuthAnswer,
  type UserInfoEndpoint,
  userIdForAuthorization,
} from "./bearer.js";
import { spendHostedMeter } from "./quota.js";

/**
 * The auth service's own userinfo endpoint, read at the hosted API boundary.
 * Every brain route resolves its bearer through this one.
 */
const hostedBrainUserInfo: UserInfoEndpoint = async (input) => {
  // SAFETY: Better Auth hands back its parsed userinfo answer as structured-clone data; the wire guards below validate the selected field.
  const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
  return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
};

/**
 * The deployment's real seams behind the brain group: the bearer's account
 * and the review allowance meter every operation spends. The key and the
 * model override are the environment's, resolved once with the services, so
 * nothing of them is read here.
 */
export function hostedBrainSeams(): BrainSeams {
  return {
    resolveUserId: (authorization) => userIdForAuthorization(authorization, hostedBrainUserInfo),
    spend: (userId) => runWeb(spendHostedMeter({ userId, now: Date.now() })),
  };
}
