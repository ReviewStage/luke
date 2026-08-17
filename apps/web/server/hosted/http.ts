import type { HostedApiError } from "../core.js";

/**
 * The response vocabulary the hosted endpoints share. Every answer is JSON,
 * and every refusal names its reason from the wire contract in
 * `@sidecar/core`'s `hosted-service` — the same module the desktop's hosted
 * clients validate against, so an error slug cannot drift between the two.
 */

export { HOSTED_API_ERROR, type HostedApiError } from "../core.js";

export const HOSTED_HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  METHOD_NOT_ALLOWED: 405,
  TOO_MANY_REQUESTS: 429,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function errorResponse(
  status: number,
  error: HostedApiError,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse(status, { error, ...extra });
}
