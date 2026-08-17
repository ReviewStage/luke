import {
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  isRecord,
  REALTIME_CALLS_PATH,
  REALTIME_CLIENT_SECRETS_PATH,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  realtimeClientSecretRequest,
  realtimeCredentialFromResponse,
  realtimeCredentialIsUsable,
  text as trimmedText,
} from "@sidecar/core";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import { type FetchLike, HOSTED_OPENAI_DEFAULTS, postOpenAi } from "./openai.js";
import type { HostedSpend } from "./quota.js";

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
 * Reads the caller's voice and pace, tolerating an empty body — the defaults
 * are a complete request. A value outside the build's own sets refuses the
 * request rather than being repaired: the desktop only sends values it
 * validated, so anything else is a bug or an impostor, and both should hear no.
 */
export async function voiceMintPreferences(
  request: Request,
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
  if (!isRecord(payload)) return undefined;

  if (payload.voice !== undefined && !isRealtimeVoice(payload.voice)) return undefined;
  if (payload.speed !== undefined && !isRealtimeVoiceSpeed(payload.speed)) return undefined;

  return {
    ...(payload.voice !== undefined ? { voice: payload.voice } : {}),
    ...(payload.speed !== undefined ? { speed: payload.speed } : {}),
  };
}

export interface VoiceMintOptions {
  request: Request;
  /** Luke's own OpenAI key, from the deployment environment; absent means the tier is off. */
  apiKey: string | undefined;
  /** A deployment-configured model override; the shared default otherwise. */
  model?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  spend: (userId: string) => Promise<HostedSpend>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export async function handleVoiceMint(options: VoiceMintOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  // Trimmed like the desktop's own key reads: a whitespace credential is the
  // kill switch, not a key, and a blank model override is no override at all.
  const apiKey = trimmedText(options.apiKey);
  const model = trimmedText(options.model);
  if (!apiKey) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const userId = await options.resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const preferences = await voiceMintPreferences(request);
  if (!preferences) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const spend = await options.spend(userId);
  if (!spend.allowed) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED, {
      quota: spend.quota,
    });
  }

  const response = await postOpenAi(
    REALTIME_CLIENT_SECRETS_PATH,
    realtimeClientSecretRequest({
      ...(model ? { model } : {}),
      ...(preferences.voice ? { voice: preferences.voice } : {}),
      ...(preferences.speed ? { speed: preferences.speed } : {}),
    }),
    { apiKey, fetch: options.fetch, timeoutMs: options.timeoutMs },
  );
  if (!response) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
  }
  if (!response.ok) {
    // Status alone diagnoses the upstream without carrying its body onward.
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR, {
      upstreamStatus: response.status,
    });
  }

  const payload: unknown = await response.json().catch(() => undefined);
  // The resolved model rides along as the fallback, like the desktop's own
  // minter: a payload that omits its model still labels the credential with
  // the model it was actually minted for.
  const credential =
    payload === undefined ? undefined : realtimeCredentialFromResponse(payload, model);
  const now = options.now ?? Date.now;
  if (!credential || !realtimeCredentialIsUsable(credential, now())) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, {
    connection: {
      ...credential,
      callsUrl: `${HOSTED_OPENAI_DEFAULTS.BASE_URL}${REALTIME_CALLS_PATH}`,
    },
    quota: spend.quota,
  });
}
