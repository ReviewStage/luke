import { recordVoiceSeconds, spendHostedMeter } from "@luke/database/models/quota";
import { voiceSessionRecord } from "@luke/database/models/voice-session-record";
import { deploymentEveOrigin } from "@luke/service/agents/brain-host/eve-origin";
import { hostedUserInfo, userIdForAuthorization } from "@luke/service/auth/bearer";
import { CRON_ENVIRONMENT } from "@luke/service/maintenance/maintenance-bounds";
import { HOSTED_OPENAI_ENVIRONMENT } from "@luke/service/providers/openai";
import type { VoiceAccounts } from "@luke/service/voice/accounts";
import { deploymentExchange } from "@luke/service/voice/deployment-exchange";
import { Keyframe } from "@luke/service/voice/keyframe";
import { LOG_EVENT, standardOutputLog } from "@luke/service/voice/log";
import {
  type VoiceServer,
  VoiceService,
  type VoiceServiceOptions,
  voiceServer,
} from "@luke/service/voice/service";
import { Effect, Layer, Redacted } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { runWeb } from "../runtime.js";

/**
 * The deployment's real seams handed to the voice service, once per function
 * instance. The `api/voice/sessions` function exports the server this
 * builds. A missing `OPENAI_API_KEY` leaves the service refusing every
 * upgrade with 503, the hosted tier's kill switch, rather than failing to
 * load.
 *
 * The exchange is passed here: with it, every call's asks are answered by
 * the hosted brain and its record written by the service, on the same
 * socket the relay pipes. What stops the
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
  /** Luke's Keyframe Labs key, which mints each call's avatar session. */
  KEYFRAME_API_KEY: "KEYFRAME_API_KEY",
  /** The stock persona every call's avatar is minted as. */
  KEYFRAME_PERSONA_ID: "LUKE_KEYFRAME_PERSONA_ID",
} as const;

const deploymentAccounts: VoiceAccounts = {
  resolveUserId: (authorization) => userIdForAuthorization(authorization, hostedUserInfo),
  spend: (userId) =>
    Effect.asVoid(Effect.suspend(() => spendHostedMeter({ userId, now: Date.now() }))),
  recordSeconds: (input) => Effect.suspend(() => recordVoiceSeconds({ ...input, now: Date.now() })),
};

/** A secret as the environment holds it, sealed: nothing where it is absent or blank, the one absence the kill switch reads. */
function configured(name: string): Redacted.Redacted | undefined {
  const named = process.env[name]?.trim();
  return named ? Redacted.make(named) : undefined;
}

/**
 * The call's avatar on this deployment's Keyframe key and persona, or none
 * where either is missing, which answers every avatar ask not configured and
 * leaves the voice untouched.
 */
function deploymentAvatar(): VoiceServiceOptions["avatar"] {
  const apiKey = configured(VOICE_FUNCTION_ENVIRONMENT.KEYFRAME_API_KEY);
  const personaId = process.env[VOICE_FUNCTION_ENVIRONMENT.KEYFRAME_PERSONA_ID]?.trim();
  if (apiKey === undefined || !personaId) return undefined;
  return {
    keyframe: Layer.provide(Keyframe.layer({ apiKey }), FetchHttpClient.layer),
    personaId,
  };
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
    avatar: deploymentAvatar(),
    exchange: deploymentExchange({
      deploymentSecret: () => configured(CRON_ENVIRONMENT.CRON_SECRET),
      eveOrigin: deploymentEveOrigin,
      openAiKey: () => configured(VOICE_FUNCTION_ENVIRONMENT.API_KEY),
      report: (message) =>
        standardOutputLog({ event: LOG_EVENT.EXCHANGE_REPORTED, reason: reportReason(message) }),
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
