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

/**
 * One UTC day of the Overview's activity chart opened into the accounts
 * behind it, answering the question the bar cannot: forty agents that day,
 * but whose? It reads the same daily-count rows the chart's bar counts, and
 * names who was active by the one meaningful-action definition, behind the
 * same admin gate and the same scope. The retired hosted tier's day rides
 * beside it for the page's retired sections. It widens no analytics event:
 * nothing here is read off a user's machine.
 */

/**
 * How many of the day's accounts one read returns, busiest first. The bound
 * exists so a heavy day degrades to a stated truncation — the totals still
 * count everyone — rather than an unbounded response.
 */
export const ADMIN_DAY_ACCOUNTS_LIMIT = 50;

/**
 * The hosted tier's day as its queries produce it. The rows arrive bounded
 * and ordered, so the totals ride their own aggregate read — folding them
 * from the rows would state a truncated day's totals short.
 */
export interface AdminDayHostedSource {
  accounts: readonly AdminDayAccount[];
  totals: AdminDayTotals;
}

/** The raw shape the queries produce for one day: its live activity, and the hosted tier's. */
export interface AdminDaySource {
  activity: AdminDayActivity;
  hosted: AdminDayHostedSource;
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
    activity: source.activity,
    totals: source.hosted.totals,
    accounts: [...source.hosted.accounts],
  };
}

export interface AdminDayOptions {
  query: AdminDayQuery;
  readDay: (day: string, now: number, scope: AdminMetricsScope) => AdminSeamEffect<AdminDayDetail>;
}

/**
 * Answers one day's read behind the same gate the overview's metrics stand
 * behind, with the same distinct refusals, plus one of its own: a request
 * naming no real UTC calendar day is a 400 before any seam is touched. A real
 * day nobody did anything on is an ordinary 200 with empty rows — unlike an
 * account, a day cannot be gone, so there is no 404 here.
 */
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
