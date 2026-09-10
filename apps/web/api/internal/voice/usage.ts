import { getDatabase } from "../../../server/db/index.js";
import { recordVoiceSeconds } from "../../../server/hosted/quota.js";
import { VOICE_SERVICE_ENVIRONMENT } from "../../../server/hosted/voice-service-secret.js";
import { handleVoiceUsage } from "../../../server/hosted/voice-usage.js";

/**
 * Records the seconds one closed GPT Live session was billed, once per session
 * id, under the shared service secret. The logic lives in
 * `server/hosted/voice-usage.ts`; this file only hands it the deployment's
 * real seams.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleVoiceUsage({
      request,
      serviceSecret: process.env[VOICE_SERVICE_ENVIRONMENT.SECRET],
      record: (report) => recordVoiceSeconds(getDatabase(), { ...report, now: Date.now() }),
    });
  },
};
