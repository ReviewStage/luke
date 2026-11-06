import type { DatabaseServices } from "@repo/database/core/query";
import type {
  AdminDayAccount,
  AdminDayActivity,
  AdminDayDetail,
  AdminDayTotals,
} from "@repo/features/admin-answer-wire";
import {
  type AdminDayQuery,
  type AdminMetricsScope,
  adminDayKey,
  adminMetricsScope,
} from "@repo/features/admin-wire";
import { Clock, Effect } from "effect";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

export const ADMIN_DAY_ACCOUNTS_LIMIT = 50;

export interface AdminDayHostedSource {
  accounts: readonly AdminDayAccount[];
  totals: AdminDayTotals;
}

export interface AdminDaySource {
  activity: AdminDayActivity;
  hosted: AdminDayHostedSource;
}

export function buildAdminDayDetail(
  source: AdminDaySource,
  now: number,
  day: string,
): AdminDayDetail {
  return {
    generatedAt: now,
    day,
    limit: ADMIN_DAY_ACCOUNTS_LIMIT,
    activity: source.activity,
    totals: source.hosted.totals,
    accounts: [...source.hosted.accounts],
  };
}

export interface AdminDayOptions {
  query: AdminDayQuery;
  readDay: (day: string, now: number, scope: AdminMetricsScope) => AdminSeamEffect<AdminDayDetail>;
}

export function handleAdminDay(
  options: AdminDayOptions,
): Effect.Effect<AdminDayDetail, AdminRefusal, DatabaseServices> {
  const { query } = options;

  const day = adminDayKey(query.date);
  if (day === undefined) return Effect.fail(ADMIN_REFUSAL.INVALID_DAY);

  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    options
      .readDay(day, now, adminMetricsScope(query.scope))
      .pipe(Effect.catchCause((cause) => unavailableSeam("admin day read failed", cause))),
  );
}
