import { Context, Effect, Layer } from "effect";
import {
  HOSTED_WS_BASE_URL,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  isRecord,
  REALTIME_CALLS_PATH,
  REALTIME_CLIENT_SECRETS_PATH,
  type RealtimeConnection,
  type RealtimeSessionOptions,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  realtimeClientSecretRequest,
  realtimeCredentialFromResponse,
  realtimeCredentialIsUsable,
  text as trimmedText,
  type UnparsedWireValue,
} from "../core.js";
import { HostedAuth, HostedClock, HostedMeterService, HostedOpenAi } from "../services/tags.js";
import {
  decodeJsonBody,
  HOSTED_HTTP_STATUS,
  invalidRequest,
  jsonResponseEffect,
  methodNotAllowed,
  quotaExhausted,
  readBoundedBody,
  unauthorized,
  unavailable,
  upstreamError,
} from "./http-effect.js";
import {
  type FetchLike,
  HOSTED_OPENAI_DEFAULTS,
  type OpenAiPostBody,
  postOpenAi,
} from "./openai.js";
import { HOSTED_METER } from "./quota.js";
import { voiceMintPreferencesSchema } from "./schema.js";

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

export interface RealtimeConnectionMintOptions {
  apiKey: string;
  model: string | undefined;
  preferences: VoiceMintPreferences;
  clientSecretRequest: (options: RealtimeSessionOptions) => OpenAiPostBody;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export type RealtimeConnectionMint = { failure: Response } | { connection: RealtimeConnection };

export class VoiceMintUpstream extends Context.Tag("@luke/web/VoiceMintUpstream")<
  VoiceMintUpstream,
  {
    readonly mint: (
      options: RealtimeConnectionMintOptions,
    ) => Effect.Effect<RealtimeConnectionMint>;
  }
>() {}

export async function voiceMintPreferences(
  request: Request,
  strictFields?: readonly string[],
): Promise<VoiceMintPreferences | undefined> {
  const raw = await request.text().catch(() => undefined);
  if (raw === undefined) return undefined;
  if (!raw.trim()) return {};

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return undefined;
  }
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

export async function mintRealtimeConnection(
  options: RealtimeConnectionMintOptions,
): Promise<RealtimeConnectionMint> {
  const sessionOptions: RealtimeSessionOptions = {};
  if (options.model) sessionOptions.model = options.model;
  if (options.preferences.voice) sessionOptions.voice = options.preferences.voice;
  if (options.preferences.speed) sessionOptions.speed = options.preferences.speed;

  const response = await postOpenAi(
    REALTIME_CLIENT_SECRETS_PATH,
    options.clientSecretRequest(sessionOptions),
    { apiKey: options.apiKey, fetch: options.fetch, timeoutMs: options.timeoutMs },
  );
  if (!response) {
    return { failure: upstreamError() };
  }
  if (!response.ok) {
    return { failure: upstreamError(response.status) };
  }

  const payload: unknown = await response.json().catch(() => undefined);
  const credential =
    payload === undefined
      ? undefined
      : realtimeCredentialFromResponse(payload as UnparsedWireValue, options.model);
  const now = options.now ?? Date.now;
  if (!credential || !realtimeCredentialIsUsable(credential, now())) {
    return { failure: upstreamError() };
  }

  return {
    connection: {
      ...credential,
      callsUrl: `${HOSTED_OPENAI_DEFAULTS.BASE_URL}${REALTIME_CALLS_PATH}`,
      wsUrl: `${HOSTED_WS_BASE_URL}?model=${credential.model}`,
    },
  };
}

export const VoiceMintUpstreamLive = Layer.succeed(VoiceMintUpstream, {
  mint: (options) => Effect.promise(() => mintRealtimeConnection(options)),
});

function decodeVoiceMintBody(
  request: Request,
  strictFields?: readonly string[],
): Effect.Effect<VoiceMintPreferences | undefined> {
  return readBoundedBody(request, 65_536).pipe(
    Effect.flatMap((raw) => {
      if (raw === undefined) return Effect.succeed(undefined);
      if (!raw.trim()) return Effect.succeed({});
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return Effect.succeed(undefined);
      }
      return Effect.succeed(decodeJsonBody(voiceMintPreferencesSchema(strictFields), payload));
    }),
  );
}

export const handleVoiceMint = Effect.fn("handleVoiceMint")(function* (request: Request) {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  const openAi = yield* HostedOpenAi;
  const apiKey = trimmedText(openAi.apiKey);
  const model = trimmedText(openAi.realtimeModel);
  if (!apiKey) {
    return unavailable();
  }

  const auth = yield* HostedAuth;
  const userId = yield* auth.resolveUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const preferences = yield* decodeVoiceMintBody(request);
  if (preferences === undefined) {
    return invalidRequest();
  }

  const meter = yield* HostedMeterService;
  const spend = yield* meter.spend(userId, HOSTED_METER.VOICE_CALL);
  if (!spend.allowed) {
    return quotaExhausted(spend.quota);
  }

  const upstream = yield* VoiceMintUpstream;
  const clock = yield* HostedClock;
  const minted = yield* upstream.mint({
    apiKey,
    model,
    preferences,
    clientSecretRequest: realtimeClientSecretRequest,
    now: () => clock.now(),
  });
  if ("failure" in minted) return minted.failure;

  return yield* jsonResponseEffect(HOSTED_HTTP_STATUS.OK, {
    connection: minted.connection,
    quota: spend.quota,
  });
});

/** @deprecated Tests use hosted-runner shims. */
export interface VoiceMintOptions {
  request: Request;
  apiKey: string | undefined;
  model?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  spend: (userId: string) => Promise<import("./quota.js").HostedSpend>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}
