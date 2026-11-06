import type { DatabaseServices } from "@repo/database/core/query";
import type {
  AdminAttentionAccount,
  AdminAutomationCount,
  AdminDatabaseHealth,
  AdminFailureCount,
  AdminIntegration,
  AdminReliability,
} from "@repo/features/admin-answer-wire";
import {
  ADMIN_RELIABILITY_WINDOWS,
  type AdminMetricsScope,
  type AdminMetricsWindow,
  type AdminWindowedQuery,
  adminMetricsScope,
  adminMetricsWindow,
} from "@repo/features/admin-wire";
import type { AgentFailure } from "@repo/features/agent-wire";
import type { AutomationRunReason } from "@repo/features/automation-wire";
import { Clock, Effect } from "effect";
import { lastNDayKeys, sum } from "./admin-metrics.js";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

export const ADMIN_ATTENTION_LIMIT = 50;

export interface AdminReliabilitySource {
  daily: {
    appTurns: ReadonlyMap<string, AdminFailureCount>;
    agentRuns: ReadonlyMap<string, AdminFailureCount>;
    abandonedTurns: ReadonlyMap<string, number>;
    automationRuns: ReadonlyMap<string, AdminAutomationCount>;
  };
  agentFailures: ReadonlyMap<AgentFailure, number>;
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

function failureShare(count: AdminFailureCount): number | null {
  return count.total === 0 ? null : count.failed / count.total;
}

function totalOf(counts: readonly AdminFailureCount[]): AdminFailureCount {
  return {
    failed: sum(counts.map((count) => count.failed)),
    total: sum(counts.map((count) => count.total)),
  };
}

export function buildAdminReliability(
  source: AdminReliabilitySource,
  now: number,
  windowDays: AdminMetricsWindow,
): AdminReliability {
  const dayKeys = lastNDayKeys(now, windowDays);
  const of = <Count>(map: ReadonlyMap<string, Count>, empty: Count) =>
    dayKeys.map((day) => map.get(day) ?? empty);

  const appTurns = of(source.daily.appTurns, NO_FAILURES);
  const agentRuns = of(source.daily.agentRuns, NO_FAILURES);
  const automationRuns = of(source.daily.automationRuns, NO_AUTOMATION_RUNS);

  return {
    generatedAt: now,
    windowDays,
    headline: {
      appTurns: totalOf(appTurns),
      agentRuns: totalOf(agentRuns),
      abandonedTurns: sum(of(source.daily.abandonedTurns, 0)),
      automationRuns: {
        ...totalOf(automationRuns),
        skipped: sum(automationRuns.map((count) => count.skipped)),
      },
    },
    daily: dayKeys.map((day, index) => ({
      day,
      appTurns: failureShare(appTurns[index] ?? NO_FAILURES),
      agentRuns: failureShare(agentRuns[index] ?? NO_FAILURES),
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
