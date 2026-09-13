import { Effect } from "effect";
import { auth } from "../auth.js";
import { unparsedWire, type WireBoundaryInput } from "../core.js";
import {
  oauthUserInfoFromAuthAnswer,
  type UserInfoEndpoint,
  userIdForAuthorization,
} from "../hosted/bearer.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../hosted/openai.js";
import { recordVoiceSeconds, spendHostedMeter, spendIntroductionMeter } from "../hosted/quota.js";
import { runWeb } from "../runtime.js";
import type { VoiceAccounts } from "./accounts.js";
import { type VoiceServer, VoiceService, voiceServer } from "./service.js";
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

/** The auth service's own userinfo endpoint, the one promise the resolution below is built on. */
const voiceUserInfo: UserInfoEndpoint = (input) =>
  Effect.tryPromise(async () => {
    // SAFETY: Better Auth hands back its parsed userinfo answer as structured-clone data; the wire guards below validate the selected field.
    const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
    return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
  });

const deploymentAccounts: VoiceAccounts = {
  resolveUserId: (authorization) => userIdForAuthorization(authorization, voiceUserInfo),
  spend: (userId) => Effect.suspend(() => spendHostedMeter({ userId, now: Date.now() })),
  spendIntroduction: () => Effect.suspend(() => spendIntroductionMeter({ now: Date.now() })),
  recordSeconds: (input) => Effect.suspend(() => recordVoiceSeconds({ ...input, now: Date.now() })),
};

let standing: VoiceServer | undefined;

/**
 * The service standing for this instance's life. Its scope is held open by
 * `Effect.never`, so the `ws` server, every session's fiber, and the claim on
 * the server this module exported belong to one scope nothing but a disposed
 * runtime closes — which is what a Vercel function gets, since it is frozen
 * between invocations and discarded with no shutdown hook to end a service
 * with. An instance whose runtime cannot be built stands none, and its server
 * keeps answering every upgrade with the 503 a deployment missing the project
 * key answers with.
 */
function standService(voice: VoiceServer): void {
  void runWeb(
    Effect.scoped(
      Effect.zipRight(
        VoiceService.make({
          server: voice,
          apiKey: process.env[VOICE_FUNCTION_ENVIRONMENT.API_KEY],
          model: process.env[VOICE_FUNCTION_ENVIRONMENT.LIVE_MODEL],
          accounts: deploymentAccounts,
          record: voiceSessionRecord(),
          run: runWeb,
        }),
        Effect.never,
      ),
    ),
  ).catch(() => undefined);
}

/** The one server of this function instance, with its service stood on first use. */
export function voiceFunctionServer() {
  if (standing === undefined) {
    standing = voiceServer();
    standService(standing);
  }
  return standing.server;
}
