import {
  ADMIN_DAY_PARAM,
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW,
  ADMIN_METRICS_WINDOW_DEFAULT,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_ROUTE_PATH,
  ADMIN_USER_ID_PARAM,
  ADMIN_USERS_SEARCH_MAX_LENGTH,
  ADMIN_USERS_SEARCH_PARAM,
  type AdminMetricsWindow,
  isUtcDayKey,
} from "../../server/admin/http";

export const METRICS_PATH = ADMIN_ROUTE_PATH.METRICS;

const USER_DETAIL_PATH = ADMIN_ROUTE_PATH.USER;

export const USERS_PATH = ADMIN_ROUTE_PATH.USERS;

export const FAVORITE_PATH = ADMIN_ROUTE_PATH.FAVORITE;

const DAY_DETAIL_PATH = ADMIN_ROUTE_PATH.DAY;

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

const ANIMATIONS_TAB_VALUE = "animations";

const WINDOW_VIEW_PARAM = "days";

const SEARCH_VIEW_PARAM = "q";

/**
 * Long enough that a typed word coalesces into one roster read, short enough
 * that the searched answer still feels like the box's own.
 */
export const SEARCH_DEBOUNCE_MS = 250;

/** The sidebar's three destinations; an open account highlights Users. */
export type AdminTab = "dashboard" | "users" | "animations";

/** Which of the page's views the address bar names. */
export type AdminView =
  | { kind: "dashboard" }
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

/** A windowed read's address: the default scope, window, and no search ride as no params. */
export function windowedReadPath(
  base: string,
  hideAdmins: boolean,
  windowDays: AdminMetricsWindow,
  search?: string,
): string {
  const params = new URLSearchParams();
  if (!hideAdmins) params.set(ADMIN_METRICS_SCOPE_PARAM, ADMIN_METRICS_SCOPE.ALL);
  if (windowDays !== ADMIN_METRICS_WINDOW_DEFAULT) {
    params.set(ADMIN_METRICS_WINDOW_PARAM, String(windowDays));
  }
  if (search !== undefined) params.set(ADMIN_USERS_SEARCH_PARAM, search);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** One account's read address, with the default window riding as no param. */
export function accountReadPath(id: string, windowDays: AdminMetricsWindow): string {
  const params = new URLSearchParams();
  params.set(ADMIN_USER_ID_PARAM, id);
  if (windowDays !== ADMIN_METRICS_WINDOW_DEFAULT) {
    params.set(ADMIN_METRICS_WINDOW_PARAM, String(windowDays));
  }
  return `${USER_DETAIL_PATH}?${params.toString()}`;
}

/** The day read's address: one day, with the default scope riding as no param. */
export function dayReadPath(day: string, hideAdmins: boolean): string {
  const params = new URLSearchParams();
  params.set(ADMIN_DAY_PARAM, day);
  if (!hideAdmins) params.set(ADMIN_METRICS_SCOPE_PARAM, ADMIN_METRICS_SCOPE.ALL);
  return `${DAY_DETAIL_PATH}?${params.toString()}`;
}
