import type { DatabaseServices } from "@repo/database/core/query";
import { utcDayKey } from "@repo/database/models/quota";
import type {
  AdminActionDay,
  AdminUserAccount,
  AdminUserActions,
  AdminUserAllTime,
  AdminUserDetail,
} from "@repo/features/admin-answer-wire";
import { MEANINGFUL_ACTION, type MeaningfulAction } from "@repo/features/admin-overview-vocabulary";
import {
  type AdminMetricsWindow,
  type AdminUserQuery,
  adminMetricsWindow,
  adminUserId,
} from "@repo/features/admin-wire";
import { Clock, Effect } from "effect";
import { DAY_MS } from "../core.js";
import { type AdminAccountSource, buildAdminAccountSupport } from "./admin-account.js";
import { ADMIN_TREND_DAYS, dayStart, lastNDayKeys, sum, trailingTrend } from "./admin-metrics.js";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

/**
 * One account's own page behind the overview's table, answering the question
 * the aggregates cannot: is this person living in the app daily, or did one heavy
 * afternoon put them on the board? It reads the same rows the overview already
 * aggregates — the user row, its linked provider rows, its meaningful actions,
 * and the retired hosted-usage days — behind the same admin gate, and it
 * widens no analytics event: every day-level signal here is a row the service
 * already keeps, never anything read off the user's machine.
 */

/** How many complete weeks the account calendar reaches back past the current one. */
const CALENDAR_COMPLETE_WEEKS = 52;

const DAYS_PER_WEEK = 7;

const ACTION_KINDS = Object.values(MEANINGFUL_ACTION);

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

/**
 * The raw shape the queries produce for one account, before the pure builder
 * zero-fills the series and reads the streak off it — split out, like the
 * overview's source, so the day arithmetic is testable without a database.
 */
export interface AdminUserSource {
  account: AdminUserAccount;
  /** Each UTC day of the calendar's trailing year with an action, by kind: the one series the activity folds. */
  actionsByDay: ReadonlyMap<string, ReadonlyMap<MeaningfulAction, number>>;
  usage: {
    byDay: ReadonlyMap<string, number>;
    /** The calendar's own rows, read at the trailing-year bound. */
    calendarByDay: ReadonlyMap<string, number>;
    allTime: AdminUserAllTime;
  };
}

/** Consecutive active days ending today or yesterday, since today may simply not have started yet. */
function currentStreak(activeFlags: readonly boolean[]): number {
  let streakEnd = activeFlags.length - 1;
  if (!activeFlags[streakEnd]) streakEnd -= 1;
  let streak = 0;
  for (let index = streakEnd; index >= 0 && activeFlags[index]; index -= 1) streak += 1;
  return streak;
}

function actionTotal(day: AdminActionDay): number {
  return sum(ACTION_KINDS.map((kind) => day[kind]));
}

/**
 * Folds the account's meaningful actions into the page's live activity. The
 * trailing year is zero-filled once, and the window, the trends, the streak,
 * and the first and last active days are all read off it; the widest window
 * and both trend runs sit inside the year.
 */
function buildAdminUserActions(
  actionsByDay: AdminUserSource["actionsByDay"],
  now: number,
  windowDays: AdminMetricsWindow,
): AdminUserActions {
  const year = calendarDayKeys(now).map((day): AdminActionDay => {
    const counts = actionsByDay.get(day);
    return {
      day,
      [MEANINGFUL_ACTION.TASKS_CREATED]: counts?.get(MEANINGFUL_ACTION.TASKS_CREATED) ?? 0,
      [MEANINGFUL_ACTION.DESCRIPTION_REVISIONS]:
        counts?.get(MEANINGFUL_ACTION.DESCRIPTION_REVISIONS) ?? 0,
      [MEANINGFUL_ACTION.AGENTS_STARTED]: counts?.get(MEANINGFUL_ACTION.AGENTS_STARTED) ?? 0,
    };
  });
  const totals = year.map(actionTotal);
  const trendTotals = totals.slice(-ADMIN_TREND_DAYS * 2);
  const windowTotals = totals.slice(-windowDays);
  const activeDays = year.filter((_, index) => (totals[index] ?? 0) > 0).map((day) => day.day);

  return {
    daily: year.slice(-windowDays),
    calendarDaily: year.map((day, index) => ({ day: day.day, count: totals[index] ?? 0 })),
    actionsTrend: trailingTrend(trendTotals, ADMIN_TREND_DAYS),
    activeDaysWindow: windowTotals.filter((total) => total > 0).length,
    activeDaysTrend: trailingTrend(
      trendTotals.map((total) => (total > 0 ? 1 : 0)),
      ADMIN_TREND_DAYS,
    ),
    currentStreakDays: currentStreak(totals.map((total) => total > 0)),
    firstActiveDay: activeDays[0] ?? null,
    lastActiveDay: activeDays.at(-1) ?? null,
  };
}

/** Shapes one account's queried source, and its support rows, into the page's answer. */
export function buildAdminUserDetail(
  source: AdminUserSource,
  support: AdminAccountSource,
  now: number,
  windowDays: AdminMetricsWindow,
): AdminUserDetail {
  const dayKeys = lastNDayKeys(now, windowDays);
  // The trends read the byDay map through their own trailing keys, like the
  // overview's, so a 7-day view still compares against the week before it.
  const trendKeys = lastNDayKeys(now, ADMIN_TREND_DAYS * 2);
  const trendTotals = trendKeys.map((day) => source.usage.byDay.get(day) ?? 0);

  const daily = dayKeys.map((day) => ({
    day,
    calls: source.usage.byDay.get(day) ?? 0,
  }));

  const calendarDaily = calendarDayKeys(now).map((day) => ({
    day,
    calls: source.usage.calendarByDay.get(day) ?? 0,
  }));

  const activeFlags = daily.map((day) => day.calls > 0);

  return {
    generatedAt: now,
    windowDays,
    account: source.account,
    actions: buildAdminUserActions(source.actionsByDay, now, windowDays),
    activity: {
      daily,
      calendarDaily,
      usageTrend: trailingTrend(trendTotals, ADMIN_TREND_DAYS),
      activeDaysWindow: activeFlags.filter(Boolean).length,
      activeDaysTrend: trailingTrend(
        trendTotals.map((total) => (total > 0 ? 1 : 0)),
        ADMIN_TREND_DAYS,
      ),
      currentStreakDays: currentStreak(activeFlags),
      callsWindow: sum(daily.map((day) => day.calls)),
      allTime: source.usage.allTime,
    },
    support: buildAdminAccountSupport(
      support,
      now,
      dayStart(dayKeys[0] ?? utcDayKey(now)).getTime(),
    ),
  };
}

export interface AdminUserOptions {
  query: AdminUserQuery;
  /** The named account's detail, or nothing when no user row carries that id. */
  readUser: (
    userId: string,
    now: number,
    windowDays: AdminMetricsWindow,
  ) => AdminSeamEffect<AdminUserDetail | undefined>;
}

/**
 * Answers one account's read behind the same gate the overview's metrics
 * stand behind, with the same distinct refusals, plus the two of its own: a
 * request that named no account, like one naming a window outside the fixed
 * set, is a 400 before any seam is touched, and an id no user row carries is
 * a 404 the page can word as the account being gone rather than the service
 * being down.
 */
export function handleAdminUser(
  options: AdminUserOptions,
): Effect.Effect<AdminUserDetail, AdminRefusal, DatabaseServices> {
  const { query } = options;

  const userId = adminUserId(query.id);
  if (userId === undefined) return Effect.fail(ADMIN_REFUSAL.MISSING_USER_ID);

  const windowDays = adminMetricsWindow(query.window);
  if (windowDays === undefined) return Effect.fail(ADMIN_REFUSAL.INVALID_WINDOW);

  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    options.readUser(userId, now, windowDays).pipe(
      Effect.catchCause((cause) => unavailableSeam("admin user read failed", cause)),
      Effect.flatMap((detail) =>
        detail === undefined ? Effect.fail(ADMIN_REFUSAL.USER_NOT_FOUND) : Effect.succeed(detail),
      ),
    ),
  );
}
