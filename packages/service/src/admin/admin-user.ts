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

const CALENDAR_COMPLETE_WEEKS = 52;

const DAYS_PER_WEEK = 7;

const ACTION_KINDS = Object.values(MEANINGFUL_ACTION);

export function calendarDayKeys(now: number): string[] {
  const daysIntoWeek = ((Math.floor(now / DAY_MS) + 4) % DAYS_PER_WEEK) + 1;
  return lastNDayKeys(now, CALENDAR_COMPLETE_WEEKS * DAYS_PER_WEEK + daysIntoWeek);
}

export interface AdminUserSource {
  account: AdminUserAccount;
  actionsByDay: ReadonlyMap<string, ReadonlyMap<MeaningfulAction, number>>;
  usage: {
    byDay: ReadonlyMap<string, number>;
    calendarByDay: ReadonlyMap<string, number>;
    allTime: AdminUserAllTime;
  };
}

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

export function buildAdminUserDetail(
  source: AdminUserSource,
  support: AdminAccountSource,
  now: number,
  windowDays: AdminMetricsWindow,
): AdminUserDetail {
  const dayKeys = lastNDayKeys(now, windowDays);
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
  readUser: (
    userId: string,
    now: number,
    windowDays: AdminMetricsWindow,
  ) => AdminSeamEffect<AdminUserDetail | undefined>;
}

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
