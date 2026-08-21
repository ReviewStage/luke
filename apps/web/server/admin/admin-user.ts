import type { AdminViewer } from "./admin-access.js";
import { isAdminRole } from "./admin-access.js";
import {
  ADMIN_METRICS_WINDOW_DAYS,
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
export function buildAdminUserDetail(source: AdminUserSource, now: number): AdminUserDetail {
  const dayKeys = lastNDayKeys(now, ADMIN_METRICS_WINDOW_DAYS);

  const daily = dayKeys.map((day) => {
    const row = source.usage.byDay.get(day);
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
    windowDays: ADMIN_METRICS_WINDOW_DAYS,
    account: source.account,
    activity: {
      daily,
      usageTrend: trailingTrend(
        daily.map((day) => day.voiceCalls + day.attentionReviews),
        ADMIN_TREND_DAYS,
      ),
      activeDaysWindow: activeFlags.filter(Boolean).length,
      activeDaysTrend: trailingTrend(
        activeFlags.map((active) => (active ? 1 : 0)),
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
  readUser: (userId: string, now: number) => Promise<AdminUserDetail | undefined>;
  now?: () => number;
}

/**
 * Answers one account's read behind the same gate the overview's metrics
 * stand behind, with the same distinct refusals, plus the two of its own: a
 * request that named no account is a 400 before any seam is touched, and an
 * id no user row carries is a 404 the page can word as the account being
 * gone rather than the service being down.
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

  const now = (options.now ?? Date.now)();
  try {
    const detail = await options.readUser(userId, now);
    if (detail === undefined) {
      return errorResponse(ADMIN_HTTP_STATUS.NOT_FOUND, ADMIN_ERROR.USER_NOT_FOUND);
    }
    return jsonResponse(ADMIN_HTTP_STATUS.OK, detail);
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
}
