import { auth } from "../auth.js";
import { getDatabase } from "../db/index.js";
import { oauthUserInfoFromAuthAnswer, userIdForAuthorization } from "../hosted/bearer.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../hosted/openai.js";
import {
  recordVoiceSeconds,
  registerVoiceSession,
  spendHostedMeter,
  voiceSessionOwner,
} from "../hosted/quota.js";
import type { VoiceAccounts } from "./accounts.js";
import { VoiceService } from "./service.js";

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
    userIdForAuthorization(authorization, async (input) =>
      oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
    ),
  spend: (userId) => spendHostedMeter(getDatabase(), { userId, now: Date.now() }),
  registerSession: (input) => registerVoiceSession(getDatabase(), input),
  sessionOwner: (sessionId) => voiceSessionOwner(getDatabase(), sessionId),
  recordSeconds: (input) => recordVoiceSeconds(getDatabase(), { ...input, now: Date.now() }),
};

let service: VoiceService | undefined;

/** The one service of this function instance, built on first use. */
export function voiceFunctionServer() {
  service ??= new VoiceService({
    apiKey: process.env[VOICE_FUNCTION_ENVIRONMENT.API_KEY],
    model: process.env[VOICE_FUNCTION_ENVIRONMENT.LIVE_MODEL],
    accounts: deploymentAccounts,
  });
  return service.server;
}
