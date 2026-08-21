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
} as const;

export const ADMIN_ERROR = {
  /** No signed-in browser session; the page should offer sign-in. */
  NOT_SIGNED_IN: "not-signed-in",
  /** Signed in, but the account is not on the admin allowlist. */
  NOT_AUTHORIZED: "not-authorized",
  METHOD_NOT_ALLOWED: "method-not-allowed",
} as const;

export type AdminError = (typeof ADMIN_ERROR)[keyof typeof ADMIN_ERROR];

export function jsonResponse<Body extends object>(status: number, body: Body): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function errorResponse(status: number, error: AdminError): Response {
  return jsonResponse(status, { error });
}
