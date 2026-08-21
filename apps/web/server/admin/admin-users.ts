import type { AdminViewer } from "./admin-access.js";
import { isAdminRole } from "./admin-access.js";
import { ADMIN_METRICS_WINDOW_DAYS } from "./admin-metrics.js";
import {
  ADMIN_ERROR,
  ADMIN_HTTP_STATUS,
  type AdminMetricsScope,
  adminMetricsScope,
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
 * How many rows one read returns. The roster is drawn whole because search
 * and the reading both happen client-side; the bound exists so an account
 * table that has grown past what a page can usefully draw degrades to a
 * stated truncation — `total` still counts everyone — rather than an
 * unbounded response.
 */
export const ADMIN_USERS_LIMIT = 200;

export interface AdminUserListRow {
  id: string;
  name: string;
  email: string;
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
  /** Every account the scope covers, counted past the row bound. */
  total: number;
  /** The bound `rows` was read under, so the page can word a truncation. */
  limit: number;
  rows: AdminUserListRow[];
}

export interface AdminUserListSource {
  total: number;
  rows: readonly AdminUserListRow[];
}

/** Stamps the queried roster with the window the aggregates cover. */
export function buildAdminUserList(source: AdminUserListSource, now: number): AdminUserList {
  return {
    generatedAt: now,
    windowDays: ADMIN_METRICS_WINDOW_DAYS,
    total: source.total,
    limit: ADMIN_USERS_LIMIT,
    rows: [...source.rows],
  };
}

export interface AdminUsersOptions {
  request: Request;
  resolveViewer: (request: Request) => Promise<AdminViewer | undefined>;
  /** Reads the roster as one viewer sees it: the favorites are theirs. */
  readUsers: (now: number, scope: AdminMetricsScope, viewerId: string) => Promise<AdminUserList>;
  now?: () => number;
}

/**
 * Answers the roster read behind the same gate and refusals the metrics read
 * stands behind, at the same scope vocabulary: the Users tab hides admin
 * accounts by default the way every dashboard count does.
 */
export async function handleAdminUsers(options: AdminUsersOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "GET") {
    return errorResponse(ADMIN_HTTP_STATUS.METHOD_NOT_ALLOWED, ADMIN_ERROR.METHOD_NOT_ALLOWED);
  }

  let viewer: AdminViewer | undefined;
  try {
    viewer = await options.resolveViewer(request);
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
  if (!viewer) {
    return errorResponse(ADMIN_HTTP_STATUS.UNAUTHORIZED, ADMIN_ERROR.NOT_SIGNED_IN);
  }
  if (!isAdminRole(viewer.role)) {
    return errorResponse(ADMIN_HTTP_STATUS.FORBIDDEN, ADMIN_ERROR.NOT_AUTHORIZED);
  }

  const now = (options.now ?? Date.now)();
  try {
    return jsonResponse(
      ADMIN_HTTP_STATUS.OK,
      await options.readUsers(now, adminMetricsScope(request.url), viewer.userId),
    );
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
}
