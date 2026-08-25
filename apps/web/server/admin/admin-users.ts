import type { AdminViewer } from "./admin-access.js";
import { isAdminRole } from "./admin-access.js";
import {
  ADMIN_ERROR,
  ADMIN_HTTP_STATUS,
  type AdminMetricsScope,
  type AdminMetricsWindow,
  adminMetricsScope,
  adminMetricsWindow,
  adminUsersSearch,
  errorResponse,
  jsonResponse,
} from "./http.js";

/**
 * The whole account roster behind the Users tab, one row per user row the
 * service holds, whether or not the account ever touched the hosted tier —
 * which is exactly what the dashboard's most-active table cannot say. The
 * rows carry the same fields the overview already names and the same
 * window aggregates, read from the same tables behind the same admin gate.
 */

/**
 * How many rows one read returns. The bound exists so an account table that
 * has grown past what a page can usefully draw degrades to a stated
 * truncation — `total` still counts everyone the filter keeps — rather than
 * an unbounded response, and the search narrows the read itself, so an
 * account past the bound is still findable by name or email.
 */
export const ADMIN_USERS_LIMIT = 200;

/**
 * An `ILIKE` pattern matching the term as a literal substring: Postgres's
 * default escape character is the backslash, so the term's own `%`, `_`,
 * and `\` are escaped before the wildcards wrap it — a searched "100%" must
 * match those four characters, never widen into a prefix scan.
 */
export function searchLikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

export interface AdminUserListRow {
  id: string;
  name: string;
  email: string;
  /** The avatar URL the sign-in provider gave the account, when it gave one. */
  image: string | null;
  admin: boolean;
  /** When the account was created, in epoch milliseconds. */
  createdAt: number;
  /** Window days with a hosted-usage row; zero for an account never active. */
  activeDays: number;
  /** The account's most recent active day inside the window, if any. */
  lastActiveDay: string | null;
  /**
   * When the account last touched the service at all, in epoch milliseconds:
   * its freshest auth-session write, which a plain sign-in moves where the
   * hosted-tier aggregates above stay at zero. Null for an account whose
   * sessions have all been pruned.
   */
  lastSeenAt: number | null;
  voiceCalls: number;
  attentionReviews: number;
  /** Whether the viewing admin starred this account, theirs alone to see. */
  favorite: boolean;
}

export interface AdminUserList {
  generatedAt: number;
  windowDays: number;
  /** Every account the scope — and the search, when one rode the read — covers, counted past the row bound. */
  total: number;
  /** The bound `rows` was read under, so the page can word a truncation. */
  limit: number;
  /** The term the rows and total were filtered by, echoed so the page words the answer it shows. */
  search: string | undefined;
  rows: AdminUserListRow[];
}

export interface AdminUserListSource {
  total: number;
  rows: readonly AdminUserListRow[];
}

/** Stamps the queried roster with the window its aggregates cover and the search that scoped it. */
export function buildAdminUserList(
  source: AdminUserListSource,
  now: number,
  windowDays: AdminMetricsWindow,
  search: string | undefined,
): AdminUserList {
  return {
    generatedAt: now,
    windowDays,
    total: source.total,
    limit: ADMIN_USERS_LIMIT,
    search,
    rows: [...source.rows],
  };
}

export interface AdminUsersOptions {
  request: Request;
  resolveViewer: (request: Request) => Promise<AdminViewer | undefined>;
  /** Reads the roster as one viewer sees it: the favorites are theirs. */
  readUsers: (
    now: number,
    scope: AdminMetricsScope,
    viewerId: string,
    windowDays: AdminMetricsWindow,
    search: string | undefined,
  ) => Promise<AdminUserList>;
  now?: () => number;
}

/**
 * Answers the roster read behind the same gate and refusals the metrics read
 * stands behind, at the same scope and window vocabulary: the Users tab hides
 * admin accounts by default the way every dashboard count does.
 */
export async function handleAdminUsers(options: AdminUsersOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "GET") {
    return errorResponse(ADMIN_HTTP_STATUS.METHOD_NOT_ALLOWED, ADMIN_ERROR.METHOD_NOT_ALLOWED);
  }

  let viewer: AdminViewer | undefined;
  try {
    viewer = await options.resolveViewer(request);
  } catch (error) {
    console.error("admin users viewer resolution failed", error);
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
  if (!viewer) {
    return errorResponse(ADMIN_HTTP_STATUS.UNAUTHORIZED, ADMIN_ERROR.NOT_SIGNED_IN);
  }
  if (!isAdminRole(viewer.role)) {
    return errorResponse(ADMIN_HTTP_STATUS.FORBIDDEN, ADMIN_ERROR.NOT_AUTHORIZED);
  }

  const windowDays = adminMetricsWindow(request.url);
  if (windowDays === undefined) {
    return errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.INVALID_WINDOW);
  }

  const search = adminUsersSearch(request.url);
  if (search === undefined) {
    return errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.INVALID_SEARCH);
  }

  const now = (options.now ?? Date.now)();
  try {
    return jsonResponse(
      ADMIN_HTTP_STATUS.OK,
      await options.readUsers(
        now,
        adminMetricsScope(request.url),
        viewer.userId,
        windowDays,
        search.term,
      ),
    );
  } catch (error) {
    console.error("admin users read failed", error);
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
}
