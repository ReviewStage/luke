import { auth } from "../../../server/auth.js";
import { getDatabase } from "../../../server/db/index.js";
import {
  oauthUserInfoFromAuthAnswer,
  userIdForAuthorization,
} from "../../../server/hosted/bearer.js";
import { spendHostedMeter } from "../../../server/hosted/quota.js";
import { handleVoiceAuthorize } from "../../../server/hosted/voice-authorize.js";
import { VOICE_SERVICE_ENVIRONMENT } from "../../../server/hosted/voice-service-secret.js";

/**
 * Tells the hosted voice service whose session it is about to create and
 * spends that account's allowance, under the shared service secret. The logic
 * lives in `server/hosted/voice-authorize.ts`; this file only hands it the
 * deployment's real seams.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleVoiceAuthorize({
      request,
      serviceSecret: process.env[VOICE_SERVICE_ENVIRONMENT.SECRET],
      resolveUserId: (authorization) =>
        userIdForAuthorization(authorization, async (input) =>
          oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
        ),
      spend: (userId) => spendHostedMeter(getDatabase(), { userId, now: Date.now() }),
    });
  },
};
