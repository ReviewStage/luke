import { Effect } from "effect";
import { auth } from "../auth.js";
import { unparsedWire, type WireBoundaryInput } from "../core.js";
import {
  oauthUserInfoFromAuthAnswer,
  type UserInfoEndpoint,
  userIdForAuthorization,
} from "../hosted/bearer.js";
import { deploymentEveOrigin } from "../hosted/brain-host/eve-origin.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../hosted/encryption.js";
import { OBSERVATION_ENVIRONMENT } from "../hosted/observation-bounds.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../hosted/openai.js";
import { recordVoiceSeconds, spendHostedMeter, spendIntroductionMeter } from "../hosted/quota.js";
import { runWeb } from "../runtime.js";
import type { VoiceAccounts } from "./accounts.js";
import { deploymentExchange } from "./deployment-exchange.js";
import { VOICE_ROUTE } from "./frames.js";
import { LOG_EVENT, standardOutputLog } from "./log.js";
import {
  type VoiceServer,
  VoiceService,
  type VoiceServiceOptions,
  voiceServer,
} from "./service.js";
import { voiceSessionRecord } from "./session-record.js";

/**
 * The deployment's real seams handed to the voice service, once per function
 * instance. The two `api/voice` functions each export the server this builds,
 * so the same service answers both upgrades and the path decides the route.
 * A missing `OPENAI_API_KEY` leaves the service refusing every upgrade with
 * 503, the hosted tier's kill switch, rather than failing to load.
 *
 * The exchange is passed here, and this is the line #1209 left out on
 * purpose: with it, every signed-in session's asks are answered by the hosted
 * brain, its record written by the service, and its briefings spoken by the
 * service's own look, on the same socket the relay pipes. What stops the
 * model's output from becoming an action is not this attachment and not the
 * sideband: it is the brain's own gauntlet, `acceptAsk` on every spoken ask,
 * eve's tool policy on every tool a turn reaches for, and `admit()` on every
 * action, exactly as a typed ask meets them. The attachment adds no admission
 * of its own.
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

/** A secret as the environment holds it: nothing where it is absent or blank, the one absence the kill switch reads. */
function configured(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/** How much of a report's own wording the log keeps: its fixed sentence, which every reporter on the exchange path puts ahead of the first colon. */
const REPORT_REASON_BOUND = 120;

/**
 * What the log keeps of an exchange's report: the sentence the reporter
 * wrote, up to the colon after which every reporter on the exchange path puts
 * the detail (a driver's or a parser's own message, which can carry the
 * value it refused), and bounded, so the function's log says which thing
 * happened and never what was said.
 */
function reportReason(message: string): string {
  const colon = message.indexOf(":");
  return (colon === -1 ? message : message.slice(0, colon)).slice(0, REPORT_REASON_BOUND);
}

/** The service's options as this deployment composes them for the server given, the exchange among them. */
export function voiceFunctionOptions(server: VoiceServer): VoiceServiceOptions {
  return {
    server,
    apiKey: process.env[VOICE_FUNCTION_ENVIRONMENT.API_KEY],
    model: process.env[VOICE_FUNCTION_ENVIRONMENT.LIVE_MODEL],
    accounts: deploymentAccounts,
    record: voiceSessionRecord(),
    run: runWeb,
    exchange: deploymentExchange({
      run: runWeb,
      encryptionSecret: () => configured(VAULT_ENCRYPTION_ENVIRONMENT.SECRET),
      deploymentSecret: () => configured(OBSERVATION_ENVIRONMENT.CRON_SECRET),
      eveOrigin: deploymentEveOrigin,
      now: () => Date.now(),
      report: (message) =>
        standardOutputLog({
          event: LOG_EVENT.EXCHANGE_REPORTED,
          route: VOICE_ROUTE.SESSIONS,
          reason: reportReason(message),
        }),
    }),
  };
}

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
    Effect.scoped(Effect.andThen(VoiceService.make(voiceFunctionOptions(voice)), Effect.never)),
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
