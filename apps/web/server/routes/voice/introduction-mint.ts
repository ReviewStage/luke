import { getDatabase } from "../../db/index.js";
import { handleIntroductionMint } from "../../hosted/introduction-mint.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../../hosted/openai.js";
import { spendIntroductionMeter } from "../../hosted/quota.js";

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
      spend: () => spendIntroductionMeter(getDatabase(), { now: Date.now() }),
    });
  },
};
