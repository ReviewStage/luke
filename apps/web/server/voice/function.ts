import { auth } from "../auth.js";
import { unparsedWire, type WireBoundaryInput } from "../core.js";
import { oauthUserInfoFromAuthAnswer, userIdForAuthorization } from "../hosted/bearer.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../hosted/openai.js";
import { recordVoiceSeconds, spendHostedMeter, spendIntroductionMeter } from "../hosted/quota.js";
import { runWeb } from "../runtime.js";
import type { VoiceAccounts } from "./accounts.js";
import { VoiceService } from "./service.js";
import { voiceSessionRecord } from "./session-record.js";

/**
 * The deployment's real seams handed to the voice service, once per function
 * instance. The two `api/voice` functions each export the server this builds,
 * so the same service answers both upgrades and the path decides the route.
 * A missing `OPENAI_API_KEY` leaves the service refusing every upgrade with
 * 503, the hosted tier's kill switch, rather than failing to load.
 */

const VOICE_FUNCTION_ENVIRONMENT = {
  API_KEY: HOSTED_OPENAI_ENVIRONMENT.API_KEY,
  /** A deployment-pinned model; `LIVE_DEFAULTS.MODEL` otherwise. */
  LIVE_MODEL: "LUKE_LIVE_MODEL",
} as const;

const deploymentAccounts: VoiceAccounts = {
  resolveUserId: (authorization) =>
    userIdForAuthorization(authorization, async (input) => {
      // SAFETY: Better Auth hands back its parsed userinfo answer as structured-clone data; the wire guards below validate the selected field.
      const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
      return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
    }),
  spend: (userId) => runWeb(spendHostedMeter({ userId, now: Date.now() })),
  spendIntroduction: () => runWeb(spendIntroductionMeter({ now: Date.now() })),
  recordSeconds: (input) => runWeb(recordVoiceSeconds({ ...input, now: Date.now() })),
};

let service: VoiceService | undefined;

/** The one service of this function instance, built on first use. */
export function voiceFunctionServer() {
  service ??= new VoiceService({
    apiKey: process.env[VOICE_FUNCTION_ENVIRONMENT.API_KEY],
    model: process.env[VOICE_FUNCTION_ENVIRONMENT.LIVE_MODEL],
    accounts: deploymentAccounts,
    record: voiceSessionRecord(runWeb),
  });
  return service.server;
}
