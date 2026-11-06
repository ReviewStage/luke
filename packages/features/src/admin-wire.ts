import { HTTP_STATUS } from "@repo/wire";
import { Schema as EffectSchema } from "effect";

export const ADMIN_PAGE_PATH = "/admin";

export const ADMIN_ROUTE_PATH = {
  METRICS: "/api/admin/metrics",
  COST: "/api/admin/cost",
  USERS: "/api/admin/users",
  USER: "/api/admin/user",
  FAVORITE: "/api/admin/favorite",
  DAY: "/api/admin/day",
  WORKSPACES: "/api/admin/workspaces",
  WORKSPACE: "/api/admin/workspace",
  RELIABILITY: "/api/admin/reliability",
} as const;

export const ADMIN_ERROR = {
  NOT_SIGNED_IN: "not-signed-in",
  NOT_AUTHORIZED: "not-authorized",
  METHOD_NOT_ALLOWED: "method-not-allowed",
  MISSING_USER_ID: "missing-user-id",
  INVALID_WINDOW: "invalid-window",
  INVALID_SEARCH: "invalid-search",
  INVALID_DAY: "invalid-day",
  USER_NOT_FOUND: "user-not-found",
  MISSING_WORKSPACE_ID: "missing-workspace-id",
  WORKSPACE_NOT_FOUND: "workspace-not-found",
  NOT_FOUND: "not-found",
  UNAVAILABLE: "unavailable",
} as const;

export type AdminError = (typeof ADMIN_ERROR)[keyof typeof ADMIN_ERROR];

export const ADMIN_QUERY = {
  SCOPE: "scope",
  WINDOW: "window",
  SEARCH: "search",
  KIND: "kind",
  DAY: "date",
  USER_ID: "id",
  WORKSPACE_ID: "id",
} as const;

export const ADMIN_HTTP_STATUS = {
  ...HTTP_STATUS,
  OK: 200,
  BAD_REQUEST: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const ADMIN_METRICS_SCOPE = {
  NON_ADMINS: "non-admins",
  ALL: "all",
} as const;

export type AdminMetricsScope = (typeof ADMIN_METRICS_SCOPE)[keyof typeof ADMIN_METRICS_SCOPE];

export interface AdminWindowedQuery {
  readonly scope?: string;
  readonly window?: string;
}

export interface AdminUsersQuery extends AdminWindowedQuery {
  readonly search?: string;
}

export interface AdminUserQuery {
  readonly id?: string;
  readonly window?: string;
}

export interface AdminWorkspaceQuery {
  readonly id?: string;
}

export interface AdminDayQuery {
  readonly date?: string;
  readonly scope?: string;
}

export interface AdminWorkspacesQuery {
  readonly scope?: string;
  readonly kind?: string;
  readonly search?: string;
}

export type AdminQuery =
  | AdminWindowedQuery
  | AdminUsersQuery
  | AdminUserQuery
  | AdminDayQuery
  | AdminWorkspacesQuery;

export const ADMIN_METRICS_SCOPE_PARAM = ADMIN_QUERY.SCOPE;

export function adminMetricsScope(value: string | undefined): AdminMetricsScope {
  return value === ADMIN_METRICS_SCOPE.ALL
    ? ADMIN_METRICS_SCOPE.ALL
    : ADMIN_METRICS_SCOPE.NON_ADMINS;
}

export const ADMIN_METRICS_WINDOW = {
  WEEK: 7,
  MONTH: 30,
  QUARTER: 90,
} as const;

export type AdminMetricsWindow = (typeof ADMIN_METRICS_WINDOW)[keyof typeof ADMIN_METRICS_WINDOW];

export const ADMIN_METRICS_WINDOW_PARAM = ADMIN_QUERY.WINDOW;

export const ADMIN_METRICS_WINDOW_DEFAULT = ADMIN_METRICS_WINDOW.MONTH;

export const ADMIN_RELIABILITY_WINDOWS: readonly AdminMetricsWindow[] = [
  ADMIN_METRICS_WINDOW.WEEK,
  ADMIN_METRICS_WINDOW.MONTH,
];

export function adminMetricsWindow(value: string | undefined): AdminMetricsWindow | undefined {
  if (value === undefined) return ADMIN_METRICS_WINDOW_DEFAULT;
  return Object.values(ADMIN_METRICS_WINDOW).find((candidate) => String(candidate) === value);
}

export const ADMIN_ATTENTION_KIND = {
  PROVIDER_KEY: "provider-key",
  INTEGRATION: "integration",
  GITHUB_INSTALLATION: "github-installation",
} as const;

export const ADMIN_ATTENTION_AGENT_DAYS = 7;

export const ADMIN_USERS_SEARCH_PARAM = ADMIN_QUERY.SEARCH;

export const ADMIN_USERS_SEARCH_MAX_LENGTH = 100;

export function adminUsersSearch(
  value: string | undefined,
): { term: string | undefined } | undefined {
  if (value === undefined) return { term: undefined };
  if (value.length > ADMIN_USERS_SEARCH_MAX_LENGTH) return undefined;
  const term = value.trim();
  return { term: term.length === 0 ? undefined : term };
}

export const ADMIN_WORKSPACES_KIND = {
  SHARED: "shared",
  ALL: "all",
} as const;

export type AdminWorkspacesKind =
  (typeof ADMIN_WORKSPACES_KIND)[keyof typeof ADMIN_WORKSPACES_KIND];

export const ADMIN_WORKSPACES_KIND_PARAM = ADMIN_QUERY.KIND;

export function adminWorkspacesKind(value: string | undefined): AdminWorkspacesKind {
  return value === ADMIN_WORKSPACES_KIND.ALL
    ? ADMIN_WORKSPACES_KIND.ALL
    : ADMIN_WORKSPACES_KIND.SHARED;
}

export const ADMIN_DAY_PARAM = ADMIN_QUERY.DAY;

const UTC_DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isUtcDayKey(value: string): boolean {
  if (!UTC_DAY_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function adminDayKey(value: string | undefined): string | undefined {
  return value !== undefined && isUtcDayKey(value) ? value : undefined;
}

export const ADMIN_USER_ID_PARAM = ADMIN_QUERY.USER_ID;

export function adminUserId(value: string | undefined): string | undefined {
  const id = value?.trim() ?? "";
  if (id.length === 0 || id.length > 128) return undefined;
  return id;
}

export const ADMIN_WORKSPACE_ID_PARAM = ADMIN_QUERY.WORKSPACE_ID;

export function adminWorkspaceId(value: string | undefined): string | undefined {
  return adminUserId(value);
}

export const ADMIN_READ = {
  COST: "cost",
  DAY: "day",
  METRICS: "metrics",
  RELIABILITY: "reliability",
  USER: "user",
  USERS: "users",
  WORKSPACE: "workspace",
  WORKSPACES: "workspaces",
} as const;

export type AdminReadProcedure = (typeof ADMIN_READ)[keyof typeof ADMIN_READ];

export const ADMIN_READ_PATH = {
  [ADMIN_READ.COST]: ADMIN_ROUTE_PATH.COST,
  [ADMIN_READ.DAY]: ADMIN_ROUTE_PATH.DAY,
  [ADMIN_READ.METRICS]: ADMIN_ROUTE_PATH.METRICS,
  [ADMIN_READ.RELIABILITY]: ADMIN_ROUTE_PATH.RELIABILITY,
  [ADMIN_READ.USER]: ADMIN_ROUTE_PATH.USER,
  [ADMIN_READ.USERS]: ADMIN_ROUTE_PATH.USERS,
  [ADMIN_READ.WORKSPACE]: ADMIN_ROUTE_PATH.WORKSPACE,
  [ADMIN_READ.WORKSPACES]: ADMIN_ROUTE_PATH.WORKSPACES,
} as const satisfies Record<AdminReadProcedure, string>;

export const ADMIN_REFUSED = {
  SIGNED_OUT: "signed-out",
  FORBIDDEN: "forbidden",
  MISSING: "missing",
  UNAVAILABLE: "unavailable",
  INTERCEPTED: "intercepted",
} as const;

export type AdminRefused = (typeof ADMIN_REFUSED)[keyof typeof ADMIN_REFUSED];

export const ADMIN_UNANSWERED = "unanswered";

export const adminReadParamsSchema = EffectSchema.Struct({
  procedure: EffectSchema.Literals(Object.values(ADMIN_READ)),
  query: EffectSchema.Record(EffectSchema.String, EffectSchema.String),
});

export type AdminReadParams = typeof adminReadParamsSchema.Type;

export const adminReadAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ answer: EffectSchema.Unknown }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals([...Object.values(ADMIN_REFUSED), ADMIN_UNANSWERED]),
  }),
]);

export type AdminReadAnswer = typeof adminReadAnswerSchema.Type;

export const adminFavoriteParamsSchema = EffectSchema.Struct({
  id: EffectSchema.NonEmptyString,
  favorite: EffectSchema.Boolean,
});

export type AdminFavoriteParams = typeof adminFavoriteParamsSchema.Type;
