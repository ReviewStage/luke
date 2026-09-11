import type * as HttpClient from "@effect/platform/HttpClient";
import { Effect } from "effect";
import {
  HOSTED_WS_BASE_URL,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  isRecord,
  REALTIME_CALLS_PATH,
  REALTIME_CLIENT_SECRETS_PATH,
  REALTIME_DEFAULTS,
  type RealtimeConnection,
  type RealtimeSessionOptions,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  realtimeCredentialFromResponse,
  realtimeCredentialIsUsable,
  type UnparsedWireValue,
} from "../core.js";
import { HOSTED_OPENAI_DEFAULTS, type OpenAiPostBody, postOpenAiEffect } from "./openai.js";

/**
 * Mints one ephemeral Realtime credential on Luke's own key for a signed-in
 * user. The session document is built here from the same shared code the
 * desktop mints with — the client's whole say is a voice and a pace, each
 * validated against the set the build ships — so nothing a caller sends can
 * reshape what the credential is for. The renderer's call still goes straight
 * to OpenAI: only the mint transits this deployment, never the audio.
 */

export interface VoiceMintPreferences {
  voice?: RealtimeVoice;
  speed?: RealtimeVoiceSpeed;
}

/**
 * Reads the caller's voice and pace out of the body already read, tolerating
 * an empty one — the defaults are a complete request. A value outside the
 * build's own sets refuses the request rather than being repaired: the
 * desktop only sends values it validated, so anything else is a bug or an
 * impostor, and both should hear no. A strict-fields allowlist additionally
 * refuses any field beyond it, for an endpoint whose callers earn no
 * tolerance for extras.
 */
export function voiceMintPreferences(
  raw: string,
  strictFields?: readonly string[],
): VoiceMintPreferences | undefined {
  if (!raw.trim()) return {};

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return undefined;
  }
  // SAFETY: JSON.parse returns a runtime value; isRecord validates the object contract.
  const wire = payload as UnparsedWireValue;
  if (!isRecord(wire)) return undefined;
  if (strictFields && Object.keys(wire).some((key) => !strictFields.includes(key))) {
    return undefined;
  }

  if (wire.voice !== undefined && !isRealtimeVoice(wire.voice)) return undefined;
  if (wire.speed !== undefined && !isRealtimeVoiceSpeed(wire.speed)) return undefined;

  const preferences: VoiceMintPreferences = {};
  if (wire.voice !== undefined) preferences.voice = wire.voice;
  if (wire.speed !== undefined) preferences.speed = wire.speed;
  return preferences;
}

export interface RealtimeConnectionMintOptions {
  apiKey: string;
  /** The resolved model override; the shared default labels the credential otherwise. */
  model: string | undefined;
  preferences: VoiceMintPreferences;
  /** Builds the session document this endpoint mints with. */
  clientSecretRequest: (options: RealtimeSessionOptions) => OpenAiPostBody;
  now?: (() => number) | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Why a mint could not be handed back. Every one of them is the same refusal
 * — the upstream failed — and the status it answered, when it answered at
 * all, is the whole of what travels onward; the upstream's own words never do.
 */
export type RealtimeConnectionMint =
  | { failure: { upstreamStatus?: number } }
  | { connection: RealtimeConnection };

/**
 * The upstream tail both mint handlers share: builds the session document
 * from the caller's validated preferences, posts it on Luke's own key, and
 * hands back either a usable connection aimed at OpenAI's canonical calls
 * endpoint or the refusal the handler answers with.
 */
export function mintRealtimeConnection(
  options: RealtimeConnectionMintOptions,
): Effect.Effect<RealtimeConnectionMint, never, HttpClient.HttpClient> {
  const sessionOptions: RealtimeSessionOptions = {};
  if (options.model) sessionOptions.model = options.model;
  if (options.preferences.voice) sessionOptions.voice = options.preferences.voice;
  if (options.preferences.speed) sessionOptions.speed = options.preferences.speed;

  return Effect.gen(function* () {
    const response = yield* postOpenAiEffect(
      REALTIME_CLIENT_SECRETS_PATH,
      options.clientSecretRequest(sessionOptions),
      { apiKey: options.apiKey, timeoutMs: options.timeoutMs },
    );
    if (!response) return { failure: {} };
    // Status alone diagnoses the upstream without carrying its body onward.
    if (!response.ok) return { failure: { upstreamStatus: response.status } };

    const payload: unknown = yield* Effect.promise(() => response.json().catch(() => undefined));
    // A payload that omits its model still labels the credential with the model
    // it was actually minted for.
    const credential =
      payload === undefined
        ? undefined
        : realtimeCredentialFromResponse(
            // SAFETY: response.json returns a runtime value; realtimeCredentialFromResponse validates the wire contract.
            payload as UnparsedWireValue,
            options.model ?? REALTIME_DEFAULTS.MODEL,
          );
    const now = options.now ?? Date.now;
    if (!credential || !realtimeCredentialIsUsable(credential, now())) return { failure: {} };

    return {
      connection: {
        ...credential,
        callsUrl: `${HOSTED_OPENAI_DEFAULTS.BASE_URL}${REALTIME_CALLS_PATH}`,
        wsUrl: `${HOSTED_WS_BASE_URL}?model=${credential.model}`,
      },
    };
  });
}
