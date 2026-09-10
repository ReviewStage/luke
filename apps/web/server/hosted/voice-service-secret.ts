import { timingSafeEqual } from "node:crypto";
import { type Schema, type UnparsedWireValue, VOICE_SERVICE_SECRET_HEADER } from "../core.js";
import {
  BODY_READ,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  readBoundedBody,
} from "./http.js";

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

/** The most either internal route reads of a body; a bearer and two ids never approach it. */
const VOICE_INTERNAL_BODY_BYTES = 16_384;

function secretMatches(request: Request, secret: string): boolean {
  const offered = Buffer.from(request.headers.get(VOICE_SERVICE_SECRET_HEADER)?.trim() ?? "");
  const wanted = Buffer.from(secret);
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

/**
 * The door every internal voice route opens with, answering the admitted
 * request or the refusal to send: POST only; a configured secret, a blank one
 * being the kill switch rather than a secret; a header that matches it; and a
 * bounded JSON body the route's own wire schema admits. Nothing of the body is
 * read before the secret has matched.
 */
export async function admitVoiceServiceRequest<Admitted>(
  request: Request,
  configuredSecret: string | undefined,
  schema: Schema<Admitted>,
): Promise<Admitted | Response> {
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
  // SAFETY: JSON.parse returns a runtime value; the route's wire schema validates it.
  const admitted = schema.parse(payload as UnparsedWireValue);
  return (
    admitted ?? errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST)
  );
}
