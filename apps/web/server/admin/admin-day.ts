import type { AdminViewer } from "./admin-access.js";
import { isAdminRole } from "./admin-access.js";
import {
  ADMIN_ERROR,
  ADMIN_HTTP_STATUS,
  type AdminMetricsScope,
  adminDayKey,
  adminMetricsScope,
  errorResponse,
  jsonResponse,
} from "./http.js";

/**
 * One UTC day of the overview's usage chart opened into the accounts behind
 * it, answering the question the bar cannot: forty calls that day, but whose?
 * It reads the same hosted-usage rows the chart's series aggregates — one row
 * per account per day, the service's own metering — behind the same admin
 * gate and the same scope, and it widens no analytics event: nothing here is
 * read off a user's machine.
 */

/**
 * How many of the day's accounts one read returns, busiest first. The bound
 * exists so a heavy day degrades to a stated truncation — the totals still
 * count everyone — rather than an unbounded response.
 */
export const ADMIN_DAY_ACCOUNTS_LIMIT = 50;

/** One account's share of the day, the same account fields the tables draw. */
export interface AdminDayAccount {
  id: string;
  name: string;
  email: string;
  /** The avatar URL the sign-in provider gave the account, when it gave one. */
  image: string | null;
  admin: boolean;
  voiceCalls: number;
  attentionReviews: number;
  total: number;
}

/** The whole day's counts, over every account the scope keeps, past the row bound. */
export interface AdminDayTotals {
  accounts: number;
  voiceCalls: number;
  attentionReviews: number;
}

/**
 * The raw shape the queries produce for one day. The rows arrive bounded and
 * ordered, so the totals ride their own aggregate read — folding them from
 * the rows would state a truncated day's totals short.
 */
export interface AdminDaySource {
  accounts: readonly AdminDayAccount[];
  totals: AdminDayTotals;
}

export interface AdminDayDetail {
  generatedAt: number;
  /** The UTC day the counts cover, as YYYY-MM-DD. */
  day: string;
  /** The bound `accounts` was read under, so the page can word a truncation. */
  limit: number;
  totals: AdminDayTotals & { total: number };
  /** The day's active accounts, busiest first, cut at the stated bound. */
  accounts: AdminDayAccount[];
}

/** Stamps one day's queried source with the day it covers and the bound it was read under. */
export function buildAdminDayDetail(
  source: AdminDaySource,
  now: number,
  day: string,
): AdminDayDetail {
  return {
    generatedAt: now,
    day,
    limit: ADMIN_DAY_ACCOUNTS_LIMIT,
    totals: {
      ...source.totals,
      total: source.totals.voiceCalls + source.totals.attentionReviews,
    },
    accounts: [...source.accounts],
  };
}

export interface AdminDayOptions {
  request: Request;
  resolveViewer: (request: Request) => Promise<AdminViewer | undefined>;
  readDay: (day: string, now: number, scope: AdminMetricsScope) => Promise<AdminDayDetail>;
  now?: () => number;
}

/**
 * Answers one day's read behind the same gate the overview's metrics stand
 * behind, with the same distinct refusals, plus one of its own: a request
 * naming no real UTC calendar day is a 400 before any seam is touched. A real
 * day nobody spent anything on is an ordinary 200 with empty rows — unlike an
 * account, a day cannot be gone, so there is no 404 here.
 */
export async function handleAdminDay(options: AdminDayOptions): Promise<Response> {
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

  const day = adminDayKey(request.url);
  if (day === undefined) {
    return errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.INVALID_DAY);
  }

  const now = (options.now ?? Date.now)();
  try {
    return jsonResponse(
      ADMIN_HTTP_STATUS.OK,
      await options.readDay(day, now, adminMetricsScope(request.url)),
    );
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
}
