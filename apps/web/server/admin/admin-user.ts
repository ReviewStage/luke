import type { AdminViewer } from "./admin-access.js";
import { isAdminRole } from "./admin-access.js";
import {
  ADMIN_TREND_DAYS,
  type AdminDailyUsage,
  type AdminTrend,
  type AdminUsageDay,
  lastNDayKeys,
  sum,
  trailingTrend,
} from "./admin-metrics.js";
import {
  ADMIN_ERROR,
  ADMIN_HTTP_STATUS,
  type AdminMetricsWindow,
  adminMetricsWindow,
  adminUserId,
  errorResponse,
  jsonResponse,
} from "./http.js";

/**
 * One account's own page behind the overview's table, answering the question
 * the aggregates cannot: is this person living in Luke daily, or did one heavy
 * afternoon put them on the board? It reads the same rows the overview already
 * aggregates — the user row, its linked provider rows, and the hosted-usage
 * days — behind the same admin gate, and it widens no analytics event: the
 * day-level signal here is the row the hosted tier already writes to meter
 * itself, never anything read off the user's machine.
 */

/** How many complete weeks the account calendar reaches back past the current one. */
export const CALENDAR_COMPLETE_WEEKS = 52;

const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;

/**
 * The account calendar's UTC day keys, oldest first: the last 52 complete
 * weeks plus the current partial one, ending on `now`'s own day — a trailing
 * year that stands apart from the page's window. The calendar's weeks open
 * on Sunday, its own requested convention, unlike the retention grid's
 * Monday-keyed weeks, which follow Postgres's `date_trunc('week')`. The
 * epoch, 1970-01-01, was a Thursday: four days past its week's Sunday.
 */
export function calendarDayKeys(now: number): string[] {
  const daysIntoWeek = ((Math.floor(now / DAY_MS) + 4) % DAYS_PER_WEEK) + 1;
  return lastNDayKeys(now, CALENDAR_COMPLETE_WEEKS * DAYS_PER_WEEK + daysIntoWeek);
}

/** The account the page names, from the service's own user row. */
export interface AdminUserAccount {
  id: string;
  name: string;
  email: string;
  /** The avatar URL the sign-in provider gave the account, when it gave one. */
  image: string | null;
  admin: boolean;
  /** When the account was created, in epoch milliseconds. */
  createdAt: number;
  /** Linked sign-in providers, as their account rows name them (e.g. "github"). */
  signInMethods: string[];
}

/** The account's whole hosted-tier history, folded to counts and two dates. */
export interface AdminUserAllTime {
  activeDays: number;
  firstActiveDay: string | null;
  lastActiveDay: string | null;
  voiceCalls: number;
  attentionReviews: number;
}

/**
 * The raw shape the queries produce for one account, before the pure builder
 * zero-fills the series and reads the streak off it — split out, like the
 * overview's source, so the day arithmetic is testable without a database.
 */
export interface AdminUserSource {
  account: AdminUserAccount;
  usage: {
    byDay: ReadonlyMap<string, AdminUsageDay>;
    /** The calendar's own rows, read at the trailing-year bound. */
    calendarByDay: ReadonlyMap<string, AdminUsageDay>;
    allTime: AdminUserAllTime;
    /** Window days on which this account reached a hosted daily ceiling. */
    quotaLimitedDaysWindow: number;
  };
}

export interface AdminUserDetail {
  generatedAt: number;
  windowDays: number;
  account: AdminUserAccount;
  activity: {
    daily: AdminDailyUsage[];
    /**
     * The calendar's zero-filled trailing year, `calendarDayKeys`'s span,
     * whatever window the rest of the page is read at.
     */
    calendarDaily: AdminDailyUsage[];
    usageTrend: AdminTrend;
    activeDaysWindow: number;
    /** Active days in the trailing run beside the run before it. */
    activeDaysTrend: AdminTrend;
    /**
     * Consecutive active days ending today or yesterday — today may simply not
     * have started yet. Read off the window's own series, so a run older than
     * the window reports the window's length and the page words it as "or
     * longer" rather than posing a truncation as the exact count.
     */
    currentStreakDays: number;
    voiceCallsWindow: number;
    attentionReviewsWindow: number;
    quotaLimitedDaysWindow: number;
    allTime: AdminUserAllTime;
  };
}

/** Shapes one account's queried source into the page's answer. */
export function buildAdminUserDetail(
  source: AdminUserSource,
  now: number,
  windowDays: AdminMetricsWindow,
): AdminUserDetail {
  const dayKeys = lastNDayKeys(now, windowDays);
  // The trends read the byDay map through their own trailing keys, like the
  // overview's, so a 7-day view still compares against the week before it.
  const trendKeys = lastNDayKeys(now, ADMIN_TREND_DAYS * 2);
  const trendTotals = trendKeys.map((day) => {
    const row = source.usage.byDay.get(day);
    return (row?.voiceCalls ?? 0) + (row?.attentionReviews ?? 0);
  });

  const daily = dayKeys.map((day) => {
    const row = source.usage.byDay.get(day);
    return {
      day,
      voiceCalls: row?.voiceCalls ?? 0,
      attentionReviews: row?.attentionReviews ?? 0,
    };
  });

  const calendarDaily = calendarDayKeys(now).map((day) => {
    const row = source.usage.calendarByDay.get(day);
    return {
      day,
      voiceCalls: row?.voiceCalls ?? 0,
      attentionReviews: row?.attentionReviews ?? 0,
    };
  });

  const activeFlags = daily.map((day) => day.voiceCalls + day.attentionReviews > 0);
  let streakEnd = activeFlags.length - 1;
  if (!activeFlags[streakEnd]) streakEnd -= 1;
  let currentStreakDays = 0;
  for (let index = streakEnd; index >= 0 && activeFlags[index]; index -= 1) {
    currentStreakDays += 1;
  }

  return {
    generatedAt: now,
    windowDays,
    account: source.account,
    activity: {
      daily,
      calendarDaily,
      usageTrend: trailingTrend(trendTotals, ADMIN_TREND_DAYS),
      activeDaysWindow: activeFlags.filter(Boolean).length,
      activeDaysTrend: trailingTrend(
        trendTotals.map((total) => (total > 0 ? 1 : 0)),
        ADMIN_TREND_DAYS,
      ),
      currentStreakDays,
      voiceCallsWindow: sum(daily.map((day) => day.voiceCalls)),
      attentionReviewsWindow: sum(daily.map((day) => day.attentionReviews)),
      quotaLimitedDaysWindow: source.usage.quotaLimitedDaysWindow,
      allTime: source.usage.allTime,
    },
  };
}

export interface AdminUserOptions {
  request: Request;
  resolveViewer: (request: Request) => Promise<AdminViewer | undefined>;
  /** The named account's detail, or nothing when no user row carries that id. */
  readUser: (
    userId: string,
    now: number,
    windowDays: AdminMetricsWindow,
  ) => Promise<AdminUserDetail | undefined>;
  now?: () => number;
}

/**
 * Answers one account's read behind the same gate the overview's metrics
 * stand behind, with the same distinct refusals, plus the two of its own: a
 * request that named no account, like one naming a window outside the fixed
 * set, is a 400 before any seam is touched, and an id no user row carries is
 * a 404 the page can word as the account being gone rather than the service
 * being down.
 */
export async function handleAdminUser(options: AdminUserOptions): Promise<Response> {
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

  const userId = adminUserId(request.url);
  if (userId === undefined) {
    return errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.MISSING_USER_ID);
  }

  const windowDays = adminMetricsWindow(request.url);
  if (windowDays === undefined) {
    return errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.INVALID_WINDOW);
  }

  const now = (options.now ?? Date.now)();
  try {
    const detail = await options.readUser(userId, now, windowDays);
    if (detail === undefined) {
      return errorResponse(ADMIN_HTTP_STATUS.NOT_FOUND, ADMIN_ERROR.USER_NOT_FOUND);
    }
    return jsonResponse(ADMIN_HTTP_STATUS.OK, detail);
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
}
