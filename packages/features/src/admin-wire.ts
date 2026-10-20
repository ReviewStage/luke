/**
 * admin-wire.ts -- the admin dashboard's addresses, refusals, and query parameters, as both sides of a read spell them.
 *
 * The dashboard is browser-only, so its refusals are its own rather than the
 * desktop's `HOSTED_API_ERROR`: the gate tells "sign in" from "signed in,
 * but not an admin", which the desktop tier has no notion of. They live here,
 * beside the paths and the parameters, because the hosted contract
 * (`contract/admin.ts`) declares them, the service answers them
 * (`@luke/service/admin/http` re-exports them), and the page reads them.
 */

/** The addresses the dashboard's reads and its one write are served at. */
export const ADMIN_ROUTE_PATH = {
  METRICS: "/api/admin/metrics",
  COST: "/api/admin/cost",
  USERS: "/api/admin/users",
  USER: "/api/admin/user",
  FAVORITE: "/api/admin/favorite",
  DAY: "/api/admin/day",
  WORKSPACES: "/api/admin/workspaces",
  RELIABILITY: "/api/admin/reliability",
} as const;

export const ADMIN_ERROR = {
  /** No signed-in browser session; the page should offer sign-in. */
  NOT_SIGNED_IN: "not-signed-in",
  /** Signed in, but the account has no admin row. */
  NOT_AUTHORIZED: "not-authorized",
  METHOD_NOT_ALLOWED: "method-not-allowed",
  /** A detail read that named no account, or named one past the id bound. */
  MISSING_USER_ID: "missing-user-id",
  /** A read that named a window outside the fixed set of lengths. */
  INVALID_WINDOW: "invalid-window",
  /** A roster read whose search term ran past the length bound. */
  INVALID_SEARCH: "invalid-search",
  /** A day read that named no real UTC calendar day. */
  INVALID_DAY: "invalid-day",
  /** The named account has no user row — deleted, or the id never existed. */
  USER_NOT_FOUND: "user-not-found",
  /** A path no admin procedure is served at. */
  NOT_FOUND: "not-found",
  /** A seam (auth or the database) did not answer; the answer is a JSON refusal, never a crash. */
  UNAVAILABLE: "unavailable",
} as const;

export type AdminError = (typeof ADMIN_ERROR)[keyof typeof ADMIN_ERROR];

/** The query parameter each read is narrowed by. */
export const ADMIN_QUERY = {
  /** How much of the user population a read covers: `all`, or by default every account but the admins. */
  SCOPE: "scope",
  /** The trailing window a read covers, in whole UTC days. */
  WINDOW: "window",
  /** A roster's or a workspace list's search term. */
  SEARCH: "search",
  /** Which workspaces the Workspaces table lists. */
  KIND: "kind",
  /** The UTC day a day read opens. */
  DAY: "date",
  /** The account a detail read or the star write names. */
  USER_ID: "id",
} as const;
