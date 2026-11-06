import {
  ADMIN_DAY_PARAM,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW,
  ADMIN_METRICS_WINDOW_DEFAULT,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_PAGE_PATH,
  ADMIN_RELIABILITY_WINDOWS,
  ADMIN_USER_ID_PARAM,
  ADMIN_USERS_SEARCH_MAX_LENGTH,
  ADMIN_USERS_SEARCH_PARAM,
  ADMIN_WORKSPACE_ID_PARAM,
  ADMIN_WORKSPACES_KIND,
  ADMIN_WORKSPACES_KIND_PARAM,
  type AdminDayQuery,
  type AdminMetricsWindow,
  type AdminUserQuery,
  type AdminUsersQuery,
  type AdminWindowedQuery,
  type AdminWorkspaceQuery,
  type AdminWorkspacesQuery,
  isUtcDayKey,
} from "@repo/features/admin-wire";
import { ADMIN_LINK_SECTION, type AdminLinkSection } from "@repo/features/link-grammar";

const ACCOUNT_VIEW_PARAM = "user";

const WORKSPACE_VIEW_PARAM = "workspace";

const DAY_VIEW_PARAM = "day";

const TAB_PARAM = "view";

const WINDOW_VIEW_PARAM = "days";

const SEARCH_VIEW_PARAM = "q";

export const SEARCH_DEBOUNCE_MS = 250;

export const ADMIN_TAB = {
  DASHBOARD: "dashboard",
  COST: "cost",
  RELIABILITY: "reliability",
  WORKSPACES: "workspaces",
  USERS: "users",
} as const;

export type AdminTab = (typeof ADMIN_TAB)[keyof typeof ADMIN_TAB];

export const ADMIN_PAGE = {
  ACCOUNT: "account",
  WORKSPACE: "workspace",
  DAY: "day",
} as const;

export type AdminView =
  | { kind: AdminTab }
  | { kind: typeof ADMIN_PAGE.ACCOUNT; id: string }
  | { kind: typeof ADMIN_PAGE.WORKSPACE; id: string }
  | { kind: typeof ADMIN_PAGE.DAY; day: string };

export function adminSection(view: AdminView): boolean {
  return Object.values(ADMIN_TAB).some((tab) => tab === view.kind);
}

export function adminSectionView(tab: AdminTab): AdminView {
  return { kind: tab };
}

export function adminSectionOf(view: AdminView): AdminTab {
  if (view.kind === ADMIN_PAGE.ACCOUNT) return ADMIN_TAB.USERS;
  if (view.kind === ADMIN_PAGE.WORKSPACE) return ADMIN_TAB.WORKSPACES;
  if (view.kind === ADMIN_PAGE.DAY) return ADMIN_TAB.DASHBOARD;
  return view.kind;
}

export function viewFromLocation(): AdminView {
  const params = new URLSearchParams(window.location.search);
  const id = params.get(ACCOUNT_VIEW_PARAM);
  if (id) return { kind: ADMIN_PAGE.ACCOUNT, id };
  const workspaceId = params.get(WORKSPACE_VIEW_PARAM);
  if (workspaceId) return { kind: ADMIN_PAGE.WORKSPACE, id: workspaceId };
  const day = params.get(DAY_VIEW_PARAM);
  if (day !== null && isUtcDayKey(day)) return { kind: ADMIN_PAGE.DAY, day };
  const tab = params.get(TAB_PARAM);
  return { kind: Object.values(ADMIN_TAB).find((each) => each === tab) ?? ADMIN_TAB.DASHBOARD };
}

export function windowFromLocation(): AdminMetricsWindow {
  const value = new URLSearchParams(window.location.search).get(WINDOW_VIEW_PARAM);
  return (
    Object.values(ADMIN_METRICS_WINDOW).find((candidate) => String(candidate) === value) ??
    ADMIN_METRICS_WINDOW_DEFAULT
  );
}

export function reliabilityWindow(windowDays: AdminMetricsWindow): AdminMetricsWindow {
  return ADMIN_RELIABILITY_WINDOWS.includes(windowDays)
    ? windowDays
    : (ADMIN_RELIABILITY_WINDOWS.at(-1) ?? ADMIN_METRICS_WINDOW_DEFAULT);
}

export function searchFromLocation(): string {
  const value = new URLSearchParams(window.location.search).get(SEARCH_VIEW_PARAM) ?? "";
  return value.slice(0, ADMIN_USERS_SEARCH_MAX_LENGTH);
}

export function searchHref(query: string): string {
  const params = new URLSearchParams(window.location.search);
  if (query) params.set(SEARCH_VIEW_PARAM, query);
  else params.delete(SEARCH_VIEW_PARAM);
  const queryString = params.toString();
  return queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
}

export function searchTerm(query: string): string | undefined {
  const term = query.trim();
  return term.length === 0 ? undefined : term;
}

function hrefWithWindow(params: URLSearchParams): string {
  const windowDays = windowFromLocation();
  if (windowDays !== ADMIN_METRICS_WINDOW_DEFAULT) {
    params.set(WINDOW_VIEW_PARAM, String(windowDays));
  }
  const query = params.toString();
  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

export function accountPageHref(id: string): string {
  const params = new URLSearchParams();
  params.set(ACCOUNT_VIEW_PARAM, id);
  return `${ADMIN_PAGE_PATH}?${params.toString()}`;
}

export function accountHref(id: string): string {
  const params = new URLSearchParams();
  params.set(ACCOUNT_VIEW_PARAM, id);
  return hrefWithWindow(params);
}

export function workspaceHref(id: string): string {
  const params = new URLSearchParams();
  params.set(WORKSPACE_VIEW_PARAM, id);
  return hrefWithWindow(params);
}

export function dayHref(day: string): string {
  const params = new URLSearchParams();
  params.set(DAY_VIEW_PARAM, day);
  return hrefWithWindow(params);
}

export function tabHref(tab: AdminTab): string {
  const params = new URLSearchParams();
  if (tab !== ADMIN_TAB.DASHBOARD) params.set(TAB_PARAM, tab);
  return hrefWithWindow(params);
}

export function windowHref(windowDays: AdminMetricsWindow): string {
  const params = new URLSearchParams(window.location.search);
  if (windowDays === ADMIN_METRICS_WINDOW_DEFAULT) params.delete(WINDOW_VIEW_PARAM);
  else params.set(WINDOW_VIEW_PARAM, String(windowDays));
  const query = params.toString();
  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

export function plainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function windowedReadQuery(
  hideAdmins: boolean,
  windowDays: AdminMetricsWindow,
): AdminWindowedQuery {
  return {
    ...(hideAdmins ? undefined : { [ADMIN_METRICS_SCOPE_PARAM]: ADMIN_METRICS_SCOPE.ALL }),
    ...(windowDays === ADMIN_METRICS_WINDOW_DEFAULT
      ? undefined
      : { [ADMIN_METRICS_WINDOW_PARAM]: String(windowDays) }),
  };
}

export function usersReadQuery(
  hideAdmins: boolean,
  windowDays: AdminMetricsWindow,
  search: string | undefined,
): AdminUsersQuery {
  return {
    ...windowedReadQuery(hideAdmins, windowDays),
    ...(search === undefined ? undefined : { [ADMIN_USERS_SEARCH_PARAM]: search }),
  };
}

export function accountReadQuery(id: string, windowDays: AdminMetricsWindow): AdminUserQuery {
  return {
    [ADMIN_USER_ID_PARAM]: id,
    ...(windowDays === ADMIN_METRICS_WINDOW_DEFAULT
      ? undefined
      : { [ADMIN_METRICS_WINDOW_PARAM]: String(windowDays) }),
  };
}

export function workspaceReadQuery(id: string): AdminWorkspaceQuery {
  return { [ADMIN_WORKSPACE_ID_PARAM]: id };
}

export function dayReadQuery(day: string, hideAdmins: boolean): AdminDayQuery {
  return {
    [ADMIN_DAY_PARAM]: day,
    ...(hideAdmins ? undefined : { [ADMIN_METRICS_SCOPE_PARAM]: ADMIN_METRICS_SCOPE.ALL }),
  };
}

export function workspacesReadQuery(
  hideAdmins: boolean,
  sharedOnly: boolean,
  search: string | undefined,
): AdminWorkspacesQuery {
  return {
    ...(hideAdmins ? undefined : { [ADMIN_METRICS_SCOPE_PARAM]: ADMIN_METRICS_SCOPE.ALL }),
    ...(sharedOnly ? undefined : { [ADMIN_WORKSPACES_KIND_PARAM]: ADMIN_WORKSPACES_KIND.ALL }),
    ...(search === undefined ? undefined : { [ADMIN_USERS_SEARCH_PARAM]: search }),
  };
}

export function adminLinkFields(view: AdminView): {
  readonly section?: AdminLinkSection;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly day?: string;
} {
  switch (view.kind) {
    case "account":
      return { userId: view.id };
    case "workspace":
      return { workspaceId: view.id };
    case "day":
      return { day: view.day };
    case "cost":
      return { section: ADMIN_LINK_SECTION.COST };
    case "reliability":
      return { section: ADMIN_LINK_SECTION.RELIABILITY };
    case "workspaces":
      return { section: ADMIN_LINK_SECTION.WORKSPACES };
    case "users":
      return { section: ADMIN_LINK_SECTION.USERS };
    default:
      return {};
  }
}

export function adminViewOfLink(fields: {
  readonly section?: AdminLinkSection | undefined;
  readonly userId?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly day?: string | undefined;
}): AdminView | undefined {
  if (fields.userId !== undefined) return { kind: ADMIN_PAGE.ACCOUNT, id: fields.userId };
  if (fields.workspaceId !== undefined)
    return { kind: ADMIN_PAGE.WORKSPACE, id: fields.workspaceId };
  if (fields.day !== undefined) return { kind: ADMIN_PAGE.DAY, day: fields.day };
  return fields.section === undefined ? undefined : { kind: fields.section };
}
