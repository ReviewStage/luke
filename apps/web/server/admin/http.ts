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
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  SERVICE_UNAVAILABLE: 503,
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

/**
 * The trailing windows a read may cover, in whole UTC days. A fixed set rather
 * than a free number because the window bounds every aggregate query the read
 * fans out into; it lives here, like the scope, because both sides of the
 * request speak it.
 */
export const ADMIN_METRICS_WINDOW = {
  WEEK: 7,
  MONTH: 30,
  QUARTER: 90,
} as const;

export type AdminMetricsWindow = (typeof ADMIN_METRICS_WINDOW)[keyof typeof ADMIN_METRICS_WINDOW];

export const ADMIN_METRICS_WINDOW_PARAM = "window";

export const ADMIN_METRICS_WINDOW_DEFAULT = ADMIN_METRICS_WINDOW.MONTH;

/**
 * The window a request asked for: the default when it asked for none, and
 * nothing when it named one outside the set. Unlike the scope, an unknown
 * value does not fall to the default — a scope misread narrows the answer
 * safely, where a window misread would reshape every number on the page while
 * the response still names the window it substituted.
 */
export function adminMetricsWindow(url: string): AdminMetricsWindow | undefined {
  const value = new URL(url).searchParams.get(ADMIN_METRICS_WINDOW_PARAM);
  if (value === null) return ADMIN_METRICS_WINDOW_DEFAULT;
  return Object.values(ADMIN_METRICS_WINDOW).find((candidate) => String(candidate) === value);
}

export const ADMIN_USERS_SEARCH_PARAM = "search";

/**
 * Generous against any name or address worth finding, and small against a
 * query string used as a battering ram: the term is the one parameter typed
 * rather than picked from a fixed set, so a length bound is the validation
 * it can carry.
 */
export const ADMIN_USERS_SEARCH_MAX_LENGTH = 100;

/**
 * The search a roster read asked for: no term when the request carried none
 * or only whitespace, and no answer at all past the length bound — refused
 * rather than silently clipped to a search nobody asked for.
 */
export function adminUsersSearch(url: string): { term: string | undefined } | undefined {
  const value = new URL(url).searchParams.get(ADMIN_USERS_SEARCH_PARAM);
  if (value === null) return { term: undefined };
  if (value.length > ADMIN_USERS_SEARCH_MAX_LENGTH) return undefined;
  const term = value.trim();
  return { term: term.length === 0 ? undefined : term };
}

export const ADMIN_DAY_PARAM = "date";

const UTC_DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a value names a real UTC calendar day. The shape check alone is not
 * enough: V8 parses `2026-02-30` by rolling it into March, so a wearer of the
 * shape must also survive the round trip back to the same key. Exported
 * because the page validates a pasted day address with the same reading the
 * endpoint refuses on.
 */
export function isUtcDayKey(value: string): boolean {
  if (!UTC_DAY_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The UTC day a detail read named, or nothing when it named no real one. */
export function adminDayKey(url: string): string | undefined {
  const value = new URL(url).searchParams.get(ADMIN_DAY_PARAM) ?? "";
  return isUtcDayKey(value) ? value : undefined;
}

export const ADMIN_USER_ID_PARAM = "id";

/**
 * The account a detail read named, or nothing when it named none worth asking
 * the database about. The bound is generous against any id Better Auth mints —
 * it exists so an arbitrarily long query string never reaches a query, not to
 * validate the id's shape, which only the user table itself can answer.
 */
export function adminUserId(url: string): string | undefined {
  const value = new URL(url).searchParams.get(ADMIN_USER_ID_PARAM)?.trim() ?? "";
  if (value.length === 0 || value.length > 128) return undefined;
  return value;
}

/**
 * Every admin answer is viewer-gated account data, so every path — refusals
 * included, since even a refusal names how far a viewer got — is marked
 * no-store: a shared machine's browser or an intermediary cache must never
 * replay one admin's view to whoever sits down next.
 */
export function jsonResponse<Body extends object>(status: number, body: Body): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function errorResponse(status: number, error: AdminError): Response {
  return jsonResponse(status, { error });
}
