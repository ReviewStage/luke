import { timingSafeEqual } from "node:crypto";
import { HTTP_STATUS } from "@repo/wire";
import { Redacted } from "effect";
import type { HostedApiError } from "../core.js";

export { HOSTED_API_ERROR, type HostedApiError } from "../core.js";

export const HOSTED_HTTP_STATUS = {
  ...HTTP_STATUS,
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  UPGRADE_REQUIRED: 426,
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

const BEARER_PREFIX = "Bearer ";

export function bearerMatchesSecret(request: Request, secret: Redacted.Redacted): boolean {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const offered = Buffer.from(authorization);
  const wanted = Buffer.from(`${BEARER_PREFIX}${Redacted.value(secret).trim()}`);
  return (
    wanted.length > BEARER_PREFIX.length &&
    offered.length === wanted.length &&
    timingSafeEqual(offered, wanted)
  );
}
