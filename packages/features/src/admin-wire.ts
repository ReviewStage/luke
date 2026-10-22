/**
 * admin-wire.ts -- the admin dashboard's addresses, refusals, query parameters, and the values each parameter may carry, as both sides of a read spell them.
 *
 * The dashboard's refusals are its own rather than the desktop's
 * `HOSTED_API_ERROR`: the gate tells "sign in" from "signed in, but not an
 * admin", which the desktop tier has no notion of. They live here, beside the
 * paths and the parameters, because the hosted contract (`contract/admin.ts`)
 * declares them, the service answers them, and the page reads them. The
 * answers themselves are `admin-answer-wire.ts`'s.
 */

import { HTTP_STATUS } from "@luke/wire";
import { Schema as EffectSchema } from "effect";

/**
 * Where the dashboard's page is served on the service's own origin: what the
 * app sidebar's Admin row opens, a browser tab's as a link beside it and the
 * Mac app's in the default browser, where the developer's session is.
 */
export const ADMIN_PAGE_PATH = "/admin";

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

/** The statuses an admin read is answered under, the hosted tier's and the dashboard's own. */
export const ADMIN_HTTP_STATUS = {
  ...HTTP_STATUS,
  OK: 200,
  BAD_REQUEST: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

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

/** A windowed read's query as its procedure hands it over: each parameter absent, or one value. */
export interface AdminWindowedQuery {
  readonly scope?: string;
  readonly window?: string;
}

/** The roster read's query: a windowed read's, and the search. */
export interface AdminUsersQuery extends AdminWindowedQuery {
  readonly search?: string;
}

/** One account's read query: the account, and the window. */
export interface AdminUserQuery {
  readonly id?: string;
  readonly window?: string;
}

/** The day read's query: the day, and the scope. */
export interface AdminDayQuery {
  readonly date?: string;
  readonly scope?: string;
}

/** The Workspaces read's query: the scope, which workspaces, and the search. */
export interface AdminWorkspacesQuery {
  readonly scope?: string;
  readonly kind?: string;
  readonly search?: string;
}

/** Any admin read's query. */
export type AdminQuery =
  | AdminWindowedQuery
  | AdminUsersQuery
  | AdminUserQuery
  | AdminDayQuery
  | AdminWorkspacesQuery;

export const ADMIN_METRICS_SCOPE_PARAM = ADMIN_QUERY.SCOPE;

/**
 * The scope a request asked for. Anything but the explicit `all` — absent,
 * misspelled, or unknown — falls to the default, because the narrower answer is
 * the safe one to give a request that did not clearly ask for more.
 */
export function adminMetricsScope(value: string | undefined): AdminMetricsScope {
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

export const ADMIN_METRICS_WINDOW_PARAM = ADMIN_QUERY.WINDOW;

export const ADMIN_METRICS_WINDOW_DEFAULT = ADMIN_METRICS_WINDOW.MONTH;

/**
 * The windows the Reliability read answers: a week and a month. A quarter is
 * refused, since a daily failure rate three months back is history, not
 * health, and the window bounds every turn row the read aggregates.
 */
export const ADMIN_RELIABILITY_WINDOWS: readonly AdminMetricsWindow[] = [
  ADMIN_METRICS_WINDOW.WEEK,
  ADMIN_METRICS_WINDOW.MONTH,
];

/**
 * The window a request asked for: the default when it asked for none, and
 * nothing when it named one outside the set. Unlike the scope, an unknown
 * value does not fall to the default — a scope misread narrows the answer
 * safely, where a window misread would reshape every number on the page while
 * the response still names the window it substituted.
 */
export function adminMetricsWindow(value: string | undefined): AdminMetricsWindow | undefined {
  if (value === undefined) return ADMIN_METRICS_WINDOW_DEFAULT;
  return Object.values(ADMIN_METRICS_WINDOW).find((candidate) => String(candidate) === value);
}

/**
 * What broke for an account on the Reliability screen, by the fixed words its
 * own row carries, and how far back its row counts the account's failed
 * coding agents, in days. Here rather than with the read because the page
 * names both, and the read's module carries query code the page must not.
 */
export const ADMIN_ATTENTION_KIND = {
  PROVIDER_KEY: "provider-key",
  INTEGRATION: "integration",
  GITHUB_INSTALLATION: "github-installation",
} as const;

export const ADMIN_ATTENTION_AGENT_DAYS = 7;

export const ADMIN_USERS_SEARCH_PARAM = ADMIN_QUERY.SEARCH;

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
export function adminUsersSearch(
  value: string | undefined,
): { term: string | undefined } | undefined {
  if (value === undefined) return { term: undefined };
  if (value.length > ADMIN_USERS_SEARCH_MAX_LENGTH) return undefined;
  const term = value.trim();
  return { term: term.length === 0 ? undefined : term };
}

/**
 * Which workspaces the Workspaces table lists: the shared ones alone, or
 * every workspace, each account's personal one included. The headline
 * counts read shared workspaces either way.
 */
export const ADMIN_WORKSPACES_KIND = {
  SHARED: "shared",
  ALL: "all",
} as const;

export type AdminWorkspacesKind =
  (typeof ADMIN_WORKSPACES_KIND)[keyof typeof ADMIN_WORKSPACES_KIND];

export const ADMIN_WORKSPACES_KIND_PARAM = ADMIN_QUERY.KIND;

/**
 * The kind a Workspaces read asked for. Like the scope, anything but the
 * explicit `all` falls to the narrower default: a misread list leaves out
 * personal workspaces rather than burying the shared ones among them.
 */
export function adminWorkspacesKind(value: string | undefined): AdminWorkspacesKind {
  return value === ADMIN_WORKSPACES_KIND.ALL
    ? ADMIN_WORKSPACES_KIND.ALL
    : ADMIN_WORKSPACES_KIND.SHARED;
}

export const ADMIN_DAY_PARAM = ADMIN_QUERY.DAY;

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
export function adminDayKey(value: string | undefined): string | undefined {
  return value !== undefined && isUtcDayKey(value) ? value : undefined;
}

export const ADMIN_USER_ID_PARAM = ADMIN_QUERY.USER_ID;

/**
 * The account a detail read named, or nothing when it named none worth asking
 * the database about. The bound is generous against any id Better Auth mints —
 * it exists so an arbitrarily long query string never reaches a query, not to
 * validate the id's shape, which only the user table itself can answer.
 */
export function adminUserId(value: string | undefined): string | undefined {
  const id = value?.trim() ?? "";
  if (id.length === 0 || id.length > 128) return undefined;
  return id;
}

/**
 * The admin reads, by their procedure's name: what a screen asks, what the
 * app's host carries to the service for it, and where each is served.
 */
export const ADMIN_READ = {
  COST: "cost",
  DAY: "day",
  METRICS: "metrics",
  RELIABILITY: "reliability",
  USER: "user",
  USERS: "users",
  WORKSPACES: "workspaces",
} as const;

export type AdminReadProcedure = (typeof ADMIN_READ)[keyof typeof ADMIN_READ];

/** Where each admin read is served. */
export const ADMIN_READ_PATH = {
  [ADMIN_READ.COST]: ADMIN_ROUTE_PATH.COST,
  [ADMIN_READ.DAY]: ADMIN_ROUTE_PATH.DAY,
  [ADMIN_READ.METRICS]: ADMIN_ROUTE_PATH.METRICS,
  [ADMIN_READ.RELIABILITY]: ADMIN_ROUTE_PATH.RELIABILITY,
  [ADMIN_READ.USER]: ADMIN_ROUTE_PATH.USER,
  [ADMIN_READ.USERS]: ADMIN_ROUTE_PATH.USERS,
  [ADMIN_READ.WORKSPACES]: ADMIN_ROUTE_PATH.WORKSPACES,
} as const satisfies Record<AdminReadProcedure, string>;

/**
 * Why an admin read was refused before it answered, in the words a screen
 * tells apart, whichever client asked: the gate's two refusals, a detail
 * read whose account is gone, the service not answering, and something in
 * front of the service answering instead, such as a preview's deployment
 * protection.
 */
export const ADMIN_REFUSED = {
  SIGNED_OUT: "signed-out",
  FORBIDDEN: "forbidden",
  MISSING: "missing",
  UNAVAILABLE: "unavailable",
  INTERCEPTED: "intercepted",
} as const;

export type AdminRefused = (typeof ADMIN_REFUSED)[keyof typeof ADMIN_REFUSED];

/** An admin read that failed for no reason a screen tells apart: the screen words it as its own. */
export const ADMIN_UNANSWERED = "unanswered";

/** One admin read as the app's window asks its host for it: the procedure, and its query parameters. */
export const adminReadParamsSchema = EffectSchema.Struct({
  procedure: EffectSchema.Literals(Object.values(ADMIN_READ)),
  query: EffectSchema.Record(EffectSchema.String, EffectSchema.String),
});

export type AdminReadParams = typeof adminReadParamsSchema.Type;

/**
 * What an admin read answered through the host: the service's answer,
 * passed through as it came (each procedure's shape is
 * `admin-answer-wire.ts`'s, which a screen names for the procedure it
 * asked), or why there is none.
 */
export const adminReadAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ answer: EffectSchema.Unknown }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals([...Object.values(ADMIN_REFUSED), ADMIN_UNANSWERED]),
  }),
]);

export type AdminReadAnswer = typeof adminReadAnswerSchema.Type;

/** The star set or taken back on one account, as the app's window asks its host for it. */
export const adminFavoriteParamsSchema = EffectSchema.Struct({
  id: EffectSchema.NonEmptyString,
  favorite: EffectSchema.Boolean,
});

export type AdminFavoriteParams = typeof adminFavoriteParamsSchema.Type;
