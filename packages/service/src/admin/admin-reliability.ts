/**
 * admin-reliability.ts -- the admin Reliability screen's answer: how often the
 * service's own work failed, why, which accounts hold a broken key or
 * connection, and what the deployment is configured with.
 *
 * Every number is an aggregate of rows the service already writes for its own
 * operation — turns, coding agents, voice sessions, automation runs, and the
 * status words on provider keys, integration connections, and GitHub
 * installations — read by a maintainer on their own service. Failures are
 * named only by the fixed words those rows carry, never by a failed turn's
 * detail, and an account is named only by the fields the other admin tables
 * already draw. Per-request HTTP error rates are not here: they live in
 * product analytics, which the answer links to.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type {
  AdminAttentionAccount,
  AdminAutomationCount,
  AdminDatabaseHealth,
  AdminFailureCount,
  AdminIntegration,
  AdminReliability,
} from "@luke/features/admin-answer-wire";
import {
  ADMIN_RELIABILITY_WINDOWS,
  type AdminMetricsScope,
  type AdminMetricsWindow,
  type AdminWindowedQuery,
  adminMetricsScope,
  adminMetricsWindow,
} from "@luke/features/admin-wire";
import type { AutomationRunReason } from "@luke/features/automation-wire";
import type { CodingAgentFailure } from "@luke/features/coding-agent-wire";
import { Clock, Effect } from "effect";
import { lastNDayKeys, sum } from "./admin-metrics.js";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

/** How many accounts the attention list names, newest breakage first. */
export const ADMIN_ATTENTION_LIMIT = 50;

/**
 * The raw shape the queries produce, keyed by UTC day, before the builder
 * zero-fills the window and folds its totals. Split out so that shaping is
 * testable without a database.
 */
export interface AdminReliabilitySource {
  daily: {
    lukeTurns: ReadonlyMap<string, AdminFailureCount>;
    agentRuns: ReadonlyMap<string, AdminFailureCount>;
    abandonedTurns: ReadonlyMap<string, number>;
    calls: ReadonlyMap<string, AdminFailureCount>;
    automationRuns: ReadonlyMap<string, AdminAutomationCount>;
  };
  agentFailures: ReadonlyMap<CodingAgentFailure, number>;
  automationReasons: ReadonlyMap<
    AutomationRunReason | null,
    { readonly skipped: number; readonly failed: number }
  >;
  attention: { total: number; accounts: readonly AdminAttentionAccount[] };
  analyticsConsoleUrl?: string | undefined;
  systemHealth: { database: AdminDatabaseHealth; integrations: readonly AdminIntegration[] };
}

const NO_FAILURES: AdminFailureCount = { failed: 0, total: 0 };

const NO_AUTOMATION_RUNS: AdminAutomationCount = { failed: 0, skipped: 0, total: 0 };

/** A share of failed work, or none where nothing ended to take a share of. */
function failureShare(count: AdminFailureCount): number | null {
  return count.total === 0 ? null : count.failed / count.total;
}

/** The window's counts folded from its zero-filled days, so the cards never disagree with the chart. */
function totalOf(counts: readonly AdminFailureCount[]): AdminFailureCount {
  return {
    failed: sum(counts.map((count) => count.failed)),
    total: sum(counts.map((count) => count.total)),
  };
}

/** Shapes the queried source into the answer, zero-filling the window and totalling in one place. */
export function buildAdminReliability(
  source: AdminReliabilitySource,
  now: number,
  windowDays: AdminMetricsWindow,
): AdminReliability {
  const dayKeys = lastNDayKeys(now, windowDays);
  const of = <Count>(map: ReadonlyMap<string, Count>, empty: Count) =>
    dayKeys.map((day) => map.get(day) ?? empty);

  const lukeTurns = of(source.daily.lukeTurns, NO_FAILURES);
  const agentRuns = of(source.daily.agentRuns, NO_FAILURES);
  const calls = of(source.daily.calls, NO_FAILURES);
  const automationRuns = of(source.daily.automationRuns, NO_AUTOMATION_RUNS);

  return {
    generatedAt: now,
    windowDays,
    headline: {
      lukeTurns: totalOf(lukeTurns),
      agentRuns: totalOf(agentRuns),
      abandonedTurns: sum(of(source.daily.abandonedTurns, 0)),
      calls: totalOf(calls),
      automationRuns: {
        ...totalOf(automationRuns),
        skipped: sum(automationRuns.map((count) => count.skipped)),
      },
    },
    daily: dayKeys.map((day, index) => ({
      day,
      lukeTurns: failureShare(lukeTurns[index] ?? NO_FAILURES),
      agentRuns: failureShare(agentRuns[index] ?? NO_FAILURES),
      calls: failureShare(calls[index] ?? NO_FAILURES),
      automationRuns: failureShare(automationRuns[index] ?? NO_AUTOMATION_RUNS),
    })),
    agentFailures: [...source.agentFailures]
      .filter(([, count]) => count > 0)
      .map(([failure, count]) => ({ failure, count }))
      .sort((left, right) => right.count - left.count),
    automationReasons: [...source.automationReasons]
      .map(([reason, counts]) => ({ reason, skipped: counts.skipped, failed: counts.failed }))
      .filter((row) => row.skipped + row.failed > 0)
      .sort((left, right) => right.skipped + right.failed - (left.skipped + left.failed)),
    attention: {
      total: source.attention.total,
      limit: ADMIN_ATTENTION_LIMIT,
      accounts: [...source.attention.accounts],
    },
    analyticsConsoleUrl: source.analyticsConsoleUrl,
    systemHealth: {
      database: source.systemHealth.database,
      integrations: [...source.systemHealth.integrations],
    },
  };
}

/**
 * The window a Reliability read asked for: the shared default where it named
 * none, and nothing where it named one outside the week and the month.
 */
function adminReliabilityWindow(value: string | undefined): AdminMetricsWindow | undefined {
  const windowDays = adminMetricsWindow(value);
  return windowDays !== undefined && ADMIN_RELIABILITY_WINDOWS.includes(windowDays)
    ? windowDays
    : undefined;
}

export interface AdminReliabilityOptions {
  query: AdminWindowedQuery;
  readReliability: (
    now: number,
    scope: AdminMetricsScope,
    windowDays: AdminMetricsWindow,
  ) => AdminSeamEffect<AdminReliability>;
}

/**
 * Answers the Reliability read behind the group's gate: a window outside the
 * week and the month is a 400 before any seam is touched, and a seam that
 * throws is the same 503 every admin read answers.
 */
export function handleAdminReliability(
  options: AdminReliabilityOptions,
): Effect.Effect<AdminReliability, AdminRefusal, DatabaseServices> {
  const { query } = options;

  const windowDays = adminReliabilityWindow(query.window);
  if (windowDays === undefined) return Effect.fail(ADMIN_REFUSAL.INVALID_WINDOW);

  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    options
      .readReliability(now, adminMetricsScope(query.scope), windowDays)
      .pipe(Effect.catchCause((cause) => unavailableSeam("admin reliability read failed", cause))),
  );
}
