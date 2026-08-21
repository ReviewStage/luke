/**
 * The response vocabulary the admin dashboard endpoint answers in. It is its
 * own, deliberately not `server/hosted/http.ts`: that module's error slugs are
 * the desktop's wire contract in `@sidecar/hosted`, validated on the desktop
 * side, and this endpoint is browser-only. Widening the desktop contract with a
 * `forbidden` the desktop never sees would be the wrong seam — the admin gate
 * distinguishes "sign in" from "you are signed in but not an admin", which the
 * desktop tier has no notion of.
 */

export const ADMIN_HTTP_STATUS = {
  OK: 200,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  METHOD_NOT_ALLOWED: 405,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const ADMIN_ERROR = {
  /** No signed-in browser session; the page should offer sign-in. */
  NOT_SIGNED_IN: "not-signed-in",
  /** Signed in, but the account has no admin row. */
  NOT_AUTHORIZED: "not-authorized",
  METHOD_NOT_ALLOWED: "method-not-allowed",
  /** A seam (auth or the database) did not answer; the answer is a JSON refusal, never a crash. */
  UNAVAILABLE: "unavailable",
} as const;

export type AdminError = (typeof ADMIN_ERROR)[keyof typeof ADMIN_ERROR];

/**
 * How much of the user population a metrics read covers. Admin accounts are the
 * maintainers' own, and their traffic reads as noise in a dashboard asking how
 * the product is doing, so the default scope leaves them out; `all` is the
 * explicit ask to count every account. The set lives here, with the rest of the
 * wire vocabulary, because both sides of the request speak it: the page asks
 * with the query parameter and the endpoint reads its answer from it.
 */
export const ADMIN_METRICS_SCOPE = {
  NON_ADMINS: "non-admins",
  ALL: "all",
} as const;

export type AdminMetricsScope = (typeof ADMIN_METRICS_SCOPE)[keyof typeof ADMIN_METRICS_SCOPE];

export const ADMIN_METRICS_SCOPE_PARAM = "scope";

/**
 * The scope a request asked for. Anything but the explicit `all` — absent,
 * misspelled, or unknown — falls to the default, because the narrower answer is
 * the safe one to give a request that did not clearly ask for more.
 */
export function adminMetricsScope(url: string): AdminMetricsScope {
  const value = new URL(url).searchParams.get(ADMIN_METRICS_SCOPE_PARAM);
  return value === ADMIN_METRICS_SCOPE.ALL
    ? ADMIN_METRICS_SCOPE.ALL
    : ADMIN_METRICS_SCOPE.NON_ADMINS;
}

export function jsonResponse<Body extends object>(status: number, body: Body): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function errorResponse(status: number, error: AdminError): Response {
  return jsonResponse(status, { error });
}
