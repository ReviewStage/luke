import type {
  AdminActivityDay,
  AdminOverview,
  AdminOverviewAccount,
} from "@repo/features/admin-answer-wire";
import {
  ACTIVITY_FEATURE,
  type ActivityFeature,
  AGENT_ORIGIN,
  type AgentOrigin,
  DAILY_COUNT,
  type DailyCount,
  FUNNEL_STEP,
  type FunnelStep,
  REACH_FEATURE,
  type ReachFeature,
} from "@repo/features/admin-overview-vocabulary";
import type { AdminMetricsWindow } from "@repo/features/admin-wire";
import {
  ADMIN_RETENTION_WEEKS,
  ADMIN_TREND_DAYS,
  type AdminMetricsSource,
  buildRetentionCohorts,
  lastNDayKeys,
  sum,
  trailingTrend,
} from "./admin-metrics.js";

export const ADMIN_OVERVIEW_ACCOUNTS_LIMIT = 10;

interface AdminActiveAccountSource {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  activeDays: number;
}

export interface AdminOverviewSource {
  activeDevelopers: { recent: number; prior: number };
  daily: ReadonlyMap<DailyCount, ReadonlyMap<string, number>>;
  prsOpened: { opened: number; merged: number };
  funnel: ReadonlyMap<FunnelStep, number>;
  reach: ReadonlyMap<ReachFeature, number>;
  topAccounts: readonly AdminActiveAccountSource[];
  accountCounts: {
    tasks: ReadonlyMap<string, number>;
    agents: ReadonlyMap<string, number>;
    prsMerged: ReadonlyMap<string, number>;
    lastSeenAt: ReadonlyMap<string, number>;
  };
  retention: AdminMetricsSource["retention"];
}

export function emptyOverviewSource(): AdminOverviewSource {
  return {
    activeDevelopers: { recent: 0, prior: 0 },
    daily: new Map(),
    prsOpened: { opened: 0, merged: 0 },
    funnel: new Map(),
    reach: new Map(),
    topAccounts: [],
    accountCounts: {
      tasks: new Map(),
      agents: new Map(),
      prsMerged: new Map(),
      lastSeenAt: new Map(),
    },
    retention: { cohortSizes: new Map(), activeByCohortWeek: new Map() },
  };
}

function shareOf(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function countsOn(
  daily: AdminOverviewSource["daily"],
  count: DailyCount,
  days: readonly string[],
): number[] {
  const byDay = daily.get(count);
  return days.map((day) => byDay?.get(day) ?? 0);
}

function buildActivityDays(
  daily: AdminOverviewSource["daily"],
  dayKeys: readonly string[],
): AdminActivityDay[] {
  const on = (feature: ActivityFeature, day: string) => daily.get(feature)?.get(day) ?? 0;
  return dayKeys.map((day) => ({
    day,
    [ACTIVITY_FEATURE.AGENTS_STARTED]: on(ACTIVITY_FEATURE.AGENTS_STARTED, day),
    [ACTIVITY_FEATURE.DESCRIPTION_REVISIONS]: on(ACTIVITY_FEATURE.DESCRIPTION_REVISIONS, day),
    [ACTIVITY_FEATURE.INBOX_ANSWERED]: on(ACTIVITY_FEATURE.INBOX_ANSWERED, day),
    [ACTIVITY_FEATURE.AUTOMATION_RUNS]: on(ACTIVITY_FEATURE.AUTOMATION_RUNS, day),
  }));
}

function activityTotals(daily: AdminOverviewSource["daily"], days: readonly string[]): number[] {
  const features = Object.values(ACTIVITY_FEATURE);
  return days.map((day) => sum(features.map((feature) => daily.get(feature)?.get(day) ?? 0)));
}

const ORIGIN_COUNT = {
  [AGENT_ORIGIN.AUTOMATION]: DAILY_COUNT.AGENTS_FROM_AUTOMATIONS,
  [AGENT_ORIGIN.SLACK]: DAILY_COUNT.AGENTS_FROM_SLACK,
  [AGENT_ORIGIN.AGENT]: DAILY_COUNT.AGENTS_FROM_AGENTS,
} as const satisfies Record<Exclude<AgentOrigin, typeof AGENT_ORIGIN.HAND>, DailyCount>;

function buildAgentOrigins(
  daily: AdminOverviewSource["daily"],
  recentKeys: readonly string[],
): AdminOverview["agentOrigins"] {
  const over = (count: DailyCount) => sum(countsOn(daily, count, recentKeys));
  const agentsStarted = over(DAILY_COUNT.AGENTS_STARTED);
  const startedElsewhere = sum(Object.values(ORIGIN_COUNT).map(over));
  const agentsOf = (origin: AgentOrigin) =>
    origin === AGENT_ORIGIN.HAND ? agentsStarted - startedElsewhere : over(ORIGIN_COUNT[origin]);
  return {
    agentsStarted,
    origins: Object.values(AGENT_ORIGIN).map((origin) => {
      const agents = agentsOf(origin);
      return { origin, agents, share: shareOf(agents, agentsStarted) };
    }),
    pilots: over(DAILY_COUNT.PILOTS_STARTED),
  };
}

function buildTopAccounts(source: AdminOverviewSource): AdminOverviewAccount[] {
  const counts = source.accountCounts;
  return source.topAccounts.map((account) => ({
    ...account,
    tasks: counts.tasks.get(account.id) ?? 0,
    agents: counts.agents.get(account.id) ?? 0,
    prsMerged: counts.prsMerged.get(account.id) ?? 0,
    lastSeenAt: counts.lastSeenAt.get(account.id) ?? null,
  }));
}

export function buildAdminOverview(
  source: AdminOverviewSource,
  now: number,
  windowDays: AdminMetricsWindow,
): AdminOverview {
  const dayKeys = lastNDayKeys(now, windowDays);
  const trendKeys = lastNDayKeys(now, ADMIN_TREND_DAYS * 2);
  const recentKeys = trendKeys.slice(-ADMIN_TREND_DAYS);
  const trendOf = (count: DailyCount) =>
    trailingTrend(countsOn(source.daily, count, trendKeys), ADMIN_TREND_DAYS);

  const signedUp = source.funnel.get(FUNNEL_STEP.SIGNED_UP) ?? 0;
  const activeDevelopers = source.activeDevelopers.recent;

  return {
    headline: {
      activeDevelopers: { days: ADMIN_TREND_DAYS, ...source.activeDevelopers },
      tasksCreated: trendOf(DAILY_COUNT.TASKS_CREATED),
      agentsStarted: trendOf(DAILY_COUNT.AGENTS_STARTED),
      prsMerged: trendOf(DAILY_COUNT.PRS_MERGED),
      prsOpened: { ...source.prsOpened },
    },
    agentOrigins: buildAgentOrigins(source.daily, recentKeys),
    activity: {
      daily: buildActivityDays(source.daily, dayKeys),
      trend: trailingTrend(activityTotals(source.daily, trendKeys), ADMIN_TREND_DAYS),
    },
    funnel: Object.values(FUNNEL_STEP).map((step) => {
      const accounts = source.funnel.get(step) ?? 0;
      return { step, accounts, share: shareOf(accounts, signedUp) };
    }),
    reach: {
      activeDevelopers,
      features: Object.values(REACH_FEATURE).map((feature) => {
        const developers = source.reach.get(feature) ?? 0;
        return { feature, developers, share: shareOf(developers, activeDevelopers) };
      }),
    },
    topAccounts: buildTopAccounts(source),
    retention: {
      weeks: ADMIN_RETENTION_WEEKS,
      cohorts: buildRetentionCohorts(source.retention, now),
    },
  };
}
