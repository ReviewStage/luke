import {
  type UnparsedWireValue,
  type VoiceAuthorizeAnswer,
  voiceAuthorizeRequestSchema,
} from "../core.js";
import {
  BODY_READ,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
  readBoundedBody,
} from "./http.js";
import type { HostedSpend } from "./quota.js";
import { refuseUnlessVoiceService, VOICE_INTERNAL_BODY_BYTES } from "./voice-service-secret.js";

/**
 * Answers the hosted voice service's question before it creates a GPT Live
 * session: whose socket is this, and does their allowance cover one more. The
 * bearer it forwards is resolved exactly as the mint resolves the one on its
 * own request, and the spend is the same daily meter every hosted operation
 * shares, taken here rather than at the session's end so a refused account
 * costs no session at all.
 */

export interface VoiceAuthorizeOptions {
  request: Request;
  /** The value of VOICE_SERVICE_SECRET; undefined means the env var is absent and the route is off. */
  serviceSecret: string | undefined;
  /** Resolves the forwarded `Authorization` value to a user, or nothing. */
  resolveUserId: (authorization: string) => Promise<string | undefined>;
  spend: (userId: string) => Promise<HostedSpend>;
}

export async function handleVoiceAuthorize(options: VoiceAuthorizeOptions): Promise<Response> {
  const { request } = options;
  const refused = refuseUnlessVoiceService(request, options.serviceSecret);
  if (refused) return refused;

  const body = await readBoundedBody(request, VOICE_INTERNAL_BODY_BYTES);
  if (body.outcome === BODY_READ.TOO_LARGE) {
    return errorResponse(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE);
  }
  if (body.outcome !== BODY_READ.READ) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  // SAFETY: JSON.parse returns a runtime value; the wire schema validates it.
  const ask = voiceAuthorizeRequestSchema.parse(payload as UnparsedWireValue);
  if (!ask) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const userId = await options.resolveUserId(ask.bearer);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const spend = await options.spend(userId);
  if (!spend.allowed) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED, {
      quota: spend.quota,
    });
  }

  const answer: VoiceAuthorizeAnswer = { userId, quota: spend.quota };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
