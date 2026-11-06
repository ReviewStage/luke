import type { DatabaseServices } from "@repo/database/core/query";
import { utcDayKey } from "@repo/database/models/quota";
import type {
  AdminMetrics,
  AdminRetentionCohort,
  AdminSignInMethods,
  AdminTrend,
} from "@repo/features/admin-answer-wire";
import {
  type AdminMetricsScope,
  type AdminMetricsWindow,
  type AdminWindowedQuery,
  adminMetricsScope,
  adminMetricsWindow,
} from "@repo/features/admin-wire";
import { Clock, Effect } from "effect";
import { DAY_MS } from "../core.js";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

export const ADMIN_TREND_DAYS = 7;

export function windowFetchDays(windowDays: AdminMetricsWindow): number {
  return Math.max(windowDays, ADMIN_TREND_DAYS * 2);
}

const WEEK_MS = 7 * DAY_MS;

export const ADMIN_RETENTION_WEEKS = 8;

const SIGN_IN_PROVIDER_ID = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

export function countSignInMethods(
  links: readonly { userId: string; providerId: string }[],
): AdminSignInMethods {
  const google = new Set<string>();
  const github = new Set<string>();
  const other = new Set<string>();
  for (const link of links) {
    if (link.providerId === SIGN_IN_PROVIDER_ID.GOOGLE) google.add(link.userId);
    else if (link.providerId === SIGN_IN_PROVIDER_ID.GITHUB) github.add(link.userId);
    else other.add(link.userId);
  }
  return { google: google.size, github: github.size, other: other.size };
}

export interface AdminMetricsSource {
  users: {
    total: number;
    signupsByDay: ReadonlyMap<string, number>;
  };
  retention: {
    cohortSizes: ReadonlyMap<string, number>;
    activeByCohortWeek: ReadonlyMap<string, ReadonlyMap<string, number>>;
  };
}

export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function cohortRetention(
  sizeRows: readonly { readonly week: string; readonly value: number }[],
  activeRows: readonly {
    readonly signupWeek: string;
    readonly activityWeek: string;
    readonly value: number;
  }[],
): AdminMetricsSource["retention"] {
  const cohortSizes = new Map(sizeRows.map((row) => [row.week, row.value]));
  const activeByCohortWeek = new Map<string, Map<string, number>>();
  for (const row of activeRows) {
    const byWeek = activeByCohortWeek.get(row.signupWeek) ?? new Map<string, number>();
    byWeek.set(row.activityWeek, row.value);
    activeByCohortWeek.set(row.signupWeek, byWeek);
  }
  return { cohortSizes, activeByCohortWeek };
}

export function lastNDayKeys(now: number, days: number): string[] {
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(utcDayKey(now - offset * DAY_MS));
  }
  return keys;
}

export function utcWeekStartKey(instant: number): string {
  const daysSinceEpoch = Math.floor(instant / DAY_MS);
  const daysSinceMonday = (daysSinceEpoch + 3) % 7;
  return utcDayKey((daysSinceEpoch - daysSinceMonday) * DAY_MS);
}

export function lastNWeekStartKeys(now: number, weeks: number): string[] {
  const keys: string[] = [];
  for (let offset = weeks - 1; offset >= 0; offset -= 1) {
    keys.push(utcWeekStartKey(now - offset * WEEK_MS));
  }
  return keys;
}

export function buildRetentionCohorts(
  retention: AdminMetricsSource["retention"],
  now: number,
): AdminRetentionCohort[] {
  const weekKeys = lastNWeekStartKeys(now, ADMIN_RETENTION_WEEKS);
  const currentWeek = utcWeekStartKey(now);

  return weekKeys.map((weekStart, index) => {
    const size = retention.cohortSizes.get(weekStart) ?? 0;
    const activeByWeek = retention.activeByCohortWeek.get(weekStart);
    const cells = weekKeys.slice(index).map((week, offset) => {
      const activeAccounts = activeByWeek?.get(week) ?? 0;
      return {
        offset,
        activeAccounts,
        share: size === 0 ? null : activeAccounts / size,
        inProgress: week === currentWeek,
      };
    });
    return { weekStart, size, cells };
  });
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function trailingTrend(counts: readonly number[], days: number): AdminTrend {
  return {
    days,
    recent: sum(counts.slice(-days)),
    prior: sum(counts.slice(-days * 2, -days)),
  };
}

export function buildAdminMetrics(
  source: AdminMetricsSource,
  now: number,
  windowDays: AdminMetricsWindow,
): Omit<AdminMetrics, "overview"> {
  const dayKeys = lastNDayKeys(now, windowDays);
  const trendKeys = lastNDayKeys(now, ADMIN_TREND_DAYS * 2);

  const dailySignups = dayKeys.map((day) => ({
    day,
    count: source.users.signupsByDay.get(day) ?? 0,
  }));

  return {
    generatedAt: now,
    windowDays,
    users: {
      total: source.users.total,
      newInWindow: sum(dailySignups.map((day) => day.count)),
      signupTrend: trailingTrend(
        trendKeys.map((day) => source.users.signupsByDay.get(day) ?? 0),
        ADMIN_TREND_DAYS,
      ),
      dailySignups,
    },
    retention: {
      weeks: ADMIN_RETENTION_WEEKS,
      cohorts: buildRetentionCohorts(source.retention, now),
    },
  };
}

export interface AdminMetricsOptions {
  query: AdminWindowedQuery;
  readMetrics: (
    now: number,
    scope: AdminMetricsScope,
    windowDays: AdminMetricsWindow,
  ) => AdminSeamEffect<AdminMetrics>;
}

export function handleAdminMetrics(
  options: AdminMetricsOptions,
): Effect.Effect<AdminMetrics, AdminRefusal, DatabaseServices> {
  const { query } = options;

  const windowDays = adminMetricsWindow(query.window);
  if (windowDays === undefined) return Effect.fail(ADMIN_REFUSAL.INVALID_WINDOW);

  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    options
      .readMetrics(now, adminMetricsScope(query.scope), windowDays)
      .pipe(Effect.catchCause((cause) => unavailableSeam("admin metrics read failed", cause))),
  );
}
