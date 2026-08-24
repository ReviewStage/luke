import { getDatabase } from "../../server/db/index.js";
import { handleIntroductionMint } from "../../server/hosted/introduction-mint.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../server/hosted/openai.js";
import { spendIntroductionMeter } from "../../server/hosted/quota.js";

/**
 * Mints the onboarding introduction's one short-lived Realtime credential for
 * a desktop with no account yet, on the key this deployment holds. The logic
 * lives in `server/hosted/introduction-mint.ts`; this file only hands it the
 * deployment's real seams.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleIntroductionMint({
      request,
      apiKey: process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY],
      model: process.env[HOSTED_OPENAI_ENVIRONMENT.REALTIME_MODEL],
      spend: (callerKey) => spendIntroductionMeter(getDatabase(), { callerKey, now: Date.now() }),
    });
  },
};
