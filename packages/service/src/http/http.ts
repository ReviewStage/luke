import { timingSafeEqual } from "node:crypto";
import { HTTP_STATUS } from "@luke/wire";
import { Redacted } from "effect";
import type { HostedApiError } from "../core.js";

/**
 * The response vocabulary the hosted endpoints share. Every answer is JSON,
 * and every refusal names its reason from the wire contract in
 * `@luke/features` — the same module the desktop's hosted
 * clients validate against, so an error slug cannot drift between the two.
 */

export { HOSTED_API_ERROR, type HostedApiError } from "../core.js";

/** The wire boundary's statuses, plus the ones only a route answers with. */
export const HOSTED_HTTP_STATUS = {
  ...HTTP_STATUS,
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export function jsonResponse<Body extends object>(status: number, body: Body): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function errorResponse(status: number, error: HostedApiError): Response {
  return jsonResponse(status, { error });
}

/** What every bearer begins with; a secret that adds nothing to it is no secret. */
const BEARER_PREFIX = "Bearer ";

/**
 * Whether the request's bearer is the deployment's own secret, compared in
 * constant time so a wrong bearer costs the same as a right one however much
 * of it matched. The secret is the caller's to read from the environment; a
 * blank one matches nothing.
 */
export function bearerMatchesSecret(request: Request, secret: Redacted.Redacted): boolean {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const offered = Buffer.from(authorization);
  // The secret is revealed here alone, into the bytes the constant-time compare reads.
  const wanted = Buffer.from(`${BEARER_PREFIX}${Redacted.value(secret).trim()}`);
  return (
    wanted.length > BEARER_PREFIX.length &&
    offered.length === wanted.length &&
    timingSafeEqual(offered, wanted)
  );
}
