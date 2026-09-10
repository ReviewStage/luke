import { timingSafeEqual } from "node:crypto";
import { VOICE_SERVICE_SECRET_HEADER } from "../core.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";

/**
 * The one identity the two internal voice routes accept: the shared secret
 * the hosted voice service holds, carried in its own header and compared in
 * constant time. An account bearer is not read on these routes at all — the
 * bearer the service forwards travels in the body, as the thing being asked
 * about rather than as who is asking.
 */

export const VOICE_SERVICE_ENVIRONMENT = {
  /** Held by this deployment and the voice service alike; absent, the two routes are off. */
  SECRET: "VOICE_SERVICE_SECRET",
} as const;

/** The smallest body either internal route reads; a bearer and two ids never approach it. */
export const VOICE_INTERNAL_BODY_BYTES = 16_384;

function secretMatches(request: Request, secret: string): boolean {
  const offered = Buffer.from(request.headers.get(VOICE_SERVICE_SECRET_HEADER)?.trim() ?? "");
  const wanted = Buffer.from(secret);
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

/**
 * The gate every internal voice route opens with: POST only, a configured
 * secret, and a header that matches it. Answers the refusal to send, or
 * nothing when the request may proceed. A blank configured secret is the kill
 * switch, not a secret, so it reads as absent.
 */
export function refuseUnlessVoiceService(
  request: Request,
  configuredSecret: string | undefined,
): Response | undefined {
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  const secret = configuredSecret?.trim();
  if (!secret) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  if (!secretMatches(request, secret)) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  return undefined;
}
