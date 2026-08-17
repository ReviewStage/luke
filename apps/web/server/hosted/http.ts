/**
 * The response vocabulary the hosted endpoints share. Every answer is JSON,
 * and every refusal names its reason from one fixed set so the desktop can
 * diagnose "voice is off" without the server writing anything sensitive.
 */

export const HOSTED_API_ERROR = {
  /** The bearer token is missing, expired, or revoked. */
  INVALID_TOKEN: "invalid-token",
  /** The request body is not what this endpoint takes. */
  INVALID_REQUEST: "invalid-request",
  /** Today's free allowance for this meter is spent. */
  QUOTA_EXHAUSTED: "quota-exhausted",
  /** The deployment holds no OpenAI key: the hosted tier is switched off. */
  UNAVAILABLE: "unavailable",
  /** OpenAI refused or failed; the status travels, the bodies never do. */
  UPSTREAM_ERROR: "upstream-error",
  METHOD_NOT_ALLOWED: "method-not-allowed",
} as const;

export type HostedApiError = (typeof HOSTED_API_ERROR)[keyof typeof HOSTED_API_ERROR];

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
