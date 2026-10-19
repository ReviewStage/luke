import {
  ADMIN_DAY_PARAM,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW,
  ADMIN_METRICS_WINDOW_DEFAULT,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_RELIABILITY_WINDOWS,
  ADMIN_USER_ID_PARAM,
  ADMIN_USERS_SEARCH_MAX_LENGTH,
  ADMIN_USERS_SEARCH_PARAM,
  ADMIN_WORKSPACES_KIND,
  ADMIN_WORKSPACES_KIND_PARAM,
  type AdminDayQuery,
  type AdminMetricsWindow,
  type AdminUserQuery,
  type AdminUsersQuery,
  type AdminWindowedQuery,
  type AdminWorkspacesQuery,
  isUtcDayKey,
} from "@luke/service/admin/http";

/**
 * The page's own addresses, distinct from the API's parameters so a pasted
 * dashboard link and an API call never read as each other. Both ride the
 * query string because the page is served at `/admin` alone — a path segment
 * would need its own route — and the account id goes back into the detail
 * endpoint's gate, never into anything rendered.
 */
const ACCOUNT_VIEW_PARAM = "user";

const DAY_VIEW_PARAM = "day";

const TAB_PARAM = "view";

const USERS_TAB_VALUE = "users";

const COST_TAB_VALUE = "cost";
const WORKSPACES_TAB_VALUE = "workspaces";

const ANIMATIONS_TAB_VALUE = "animations";

const RELIABILITY_TAB_VALUE = "reliability";

const WINDOW_VIEW_PARAM = "days";

const SEARCH_VIEW_PARAM = "q";

/**
 * Long enough that a typed word coalesces into one roster read, short enough
 * that the searched answer still feels like the box's own.
 */
export const SEARCH_DEBOUNCE_MS = 250;

/** The sidebar's destinations; an open account highlights Users. */
export type AdminTab = "dashboard" | "cost" | "reliability" | "workspaces" | "users" | "animations";

/** Which of the page's views the address bar names. */
export type AdminView =
  | { kind: "dashboard" }
  | { kind: "cost" }
  | { kind: "reliability" }
  | { kind: "workspaces" }
  | { kind: "users" }
  | { kind: "animations" }
  | { kind: "account"; id: string }
  | { kind: "day"; day: string };

export function viewFromLocation(): AdminView {
  const params = new URLSearchParams(window.location.search);
  const id = params.get(ACCOUNT_VIEW_PARAM);
  if (id) return { kind: "account", id };
  // An address naming no real UTC day is the plain dashboard rather than a
  // broken page, the same reading an out-of-set window gets.
  const day = params.get(DAY_VIEW_PARAM);
  if (day !== null && isUtcDayKey(day)) return { kind: "day", day };
  if (params.get(TAB_PARAM) === COST_TAB_VALUE) return { kind: "cost" };
  if (params.get(TAB_PARAM) === RELIABILITY_TAB_VALUE) return { kind: "reliability" };
  if (params.get(TAB_PARAM) === WORKSPACES_TAB_VALUE) return { kind: "workspaces" };
  if (params.get(TAB_PARAM) === USERS_TAB_VALUE) return { kind: "users" };
  if (params.get(TAB_PARAM) === ANIMATIONS_TAB_VALUE) return { kind: "animations" };
  return { kind: "dashboard" };
}

/**
 * The window the address bar names, so a 90-day view is shareable and survives
 * a reload. An address naming no window, or one outside the set, is the
 * default view rather than a broken page — a link is the reader's, not a
 * request the API gets to refuse.
 */
export function windowFromLocation(): AdminMetricsWindow {
  const value = new URLSearchParams(window.location.search).get(WINDOW_VIEW_PARAM);
  return (
    Object.values(ADMIN_METRICS_WINDOW).find((candidate) => String(candidate) === value) ??
    ADMIN_METRICS_WINDOW_DEFAULT
  );
}

/**
 * The window the Reliability screen reads: the shared one where the screen
 * offers it, and the longest it offers otherwise, so a 90-day address opens
 * the month rather than a read the endpoint refuses.
 */
export function reliabilityWindow(windowDays: AdminMetricsWindow): AdminMetricsWindow {
  return ADMIN_RELIABILITY_WINDOWS.includes(windowDays)
    ? windowDays
    : (ADMIN_RELIABILITY_WINDOWS.at(-1) ?? ADMIN_METRICS_WINDOW_DEFAULT);
}

/**
 * The search the address bar names, so a searched roster is shareable and
 * survives a reload. An address naming a term past the API's length bound is
 * clipped to it rather than refused — a link is the reader's — and matches
 * the bound the input below enforces on typing.
 */
export function searchFromLocation(): string {
  const value = new URLSearchParams(window.location.search).get(SEARCH_VIEW_PARAM) ?? "";
  return value.slice(0, ADMIN_USERS_SEARCH_MAX_LENGTH);
}

/**
 * The current address with the search set or cleared. Typing rewrites the
 * entry in place rather than pushing one, so the back button walks views,
 * not keystrokes.
 */
export function searchHref(query: string): string {
  const params = new URLSearchParams(window.location.search);
  if (query) params.set(SEARCH_VIEW_PARAM, query);
  else params.delete(SEARCH_VIEW_PARAM);
  const queryString = params.toString();
  return queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
}

/** The term a typed query asks the service to search for: none when blank. */
export function searchTerm(query: string): string | undefined {
  const term = query.trim();
  return term.length === 0 ? undefined : term;
}

/**
 * A page address from its own params, carrying the window the address bar
 * currently names, so navigating between views keeps the chosen window. The
 * default window rides as no param at all, keeping the plain addresses plain.
 */
function hrefWithWindow(params: URLSearchParams): string {
  const windowDays = windowFromLocation();
  if (windowDays !== ADMIN_METRICS_WINDOW_DEFAULT) {
    params.set(WINDOW_VIEW_PARAM, String(windowDays));
  }
  const query = params.toString();
  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

export function accountHref(id: string): string {
  const params = new URLSearchParams();
  params.set(ACCOUNT_VIEW_PARAM, id);
  return hrefWithWindow(params);
}

export function dayHref(day: string): string {
  const params = new URLSearchParams();
  params.set(DAY_VIEW_PARAM, day);
  return hrefWithWindow(params);
}

export function tabHref(tab: AdminTab): string {
  const params = new URLSearchParams();
  if (tab === "cost") params.set(TAB_PARAM, COST_TAB_VALUE);
  if (tab === "reliability") params.set(TAB_PARAM, RELIABILITY_TAB_VALUE);
  if (tab === "workspaces") params.set(TAB_PARAM, WORKSPACES_TAB_VALUE);
  if (tab === "users") params.set(TAB_PARAM, USERS_TAB_VALUE);
  if (tab === "animations") params.set(TAB_PARAM, ANIMATIONS_TAB_VALUE);
  return hrefWithWindow(params);
}

export function windowHref(windowDays: AdminMetricsWindow): string {
  const params = new URLSearchParams(window.location.search);
  if (windowDays === ADMIN_METRICS_WINDOW_DEFAULT) params.delete(WINDOW_VIEW_PARAM);
  else params.set(WINDOW_VIEW_PARAM, String(windowDays));
  const query = params.toString();
  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

/**
 * Whether a click on a link is asking this page to navigate, or asking the
 * browser for its own gesture — a new tab, a window, a download — which the
 * real anchor underneath must keep answering.
 */
export function plainLeftClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** A windowed read's query: the default scope and window ride as no params. */
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

/** The roster read's query: a windowed read's, and the search where one rides. */
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

/** One account's read query, with the default window riding as no param. */
export function accountReadQuery(id: string, windowDays: AdminMetricsWindow): AdminUserQuery {
  return {
    [ADMIN_USER_ID_PARAM]: id,
    ...(windowDays === ADMIN_METRICS_WINDOW_DEFAULT
      ? undefined
      : { [ADMIN_METRICS_WINDOW_PARAM]: String(windowDays) }),
  };
}

/** The day read's query: one day, with the default scope riding as no param. */
export function dayReadQuery(day: string, hideAdmins: boolean): AdminDayQuery {
  return {
    [ADMIN_DAY_PARAM]: day,
    ...(hideAdmins ? undefined : { [ADMIN_METRICS_SCOPE_PARAM]: ADMIN_METRICS_SCOPE.ALL }),
  };
}

/**
 * The Workspaces read's query: the default scope, the shared-only list, and
 * no search ride as no params. It reads no window, because its activity
 * counts are always the trailing week.
 */
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
