/**
 * admin-overview.ts -- what the Overview measures of the product as it is
 * today: tasks, plans, coding agents, pull requests, the inbox, and
 * automations, shaped from the rows the queries read.
 *
 * Everything here is an aggregate or a per-account count of rows the service already
 * keeps for its own operation. No title, plan text, prompt, message, workspace
 * name, or repository name is read, so none can reach the answer. The queries
 * live in `admin-overview-queries.ts`; this module is the pure fold, so the
 * part with off-by-one risk in a day window is tested without a database.
 *
 * A *meaningful action* is one of three things an account does: creates a
 * task, writes a plan revision as the developer, or starts a coding agent. An
 * *active developer* is an account with at least one in the
 * run being counted. `meaningfulActions` in the queries module is the one
 * definition every read here that says "active" counts through.
 */

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

/** How many of the most active accounts the overview names. */
export const ADMIN_OVERVIEW_ACCOUNTS_LIMIT = 10;

/** One ranked account as the query reads it, before its per-feature counts join it. */
interface AdminActiveAccountSource {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  activeDays: number;
}

/** The raw shape the overview's queries produce. */
export interface AdminOverviewSource {
  activeDevelopers: { recent: number; prior: number };
  /** Each daily count by UTC day, read from the fetch bound so both trend runs are held. */
  daily: ReadonlyMap<DailyCount, ReadonlyMap<string, number>>;
  prsOpened: { opened: number; merged: number };
  funnel: ReadonlyMap<FunnelStep, number>;
  reach: ReadonlyMap<ReachFeature, number>;
  /** The most active accounts, already ranked and cut at the bound. */
  topAccounts: readonly AdminActiveAccountSource[];
  /** Per-account counts for the ranked accounts alone, by account id; an absent id is a zero. */
  accountCounts: {
    tasks: ReadonlyMap<string, number>;
    agents: ReadonlyMap<string, number>;
    prsMerged: ReadonlyMap<string, number>;
    lastSeenAt: ReadonlyMap<string, number>;
  };
  /** Cohort sizes, and the cohorts' accounts with a meaningful action per week. */
  retention: AdminMetricsSource["retention"];
}

/** The source a database that did not answer stands in with: nothing counted, nobody named. */
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

/** One daily count over the given day keys, a missing day a zero. */
function countsOn(
  daily: AdminOverviewSource["daily"],
  count: DailyCount,
  days: readonly string[],
): number[] {
  const byDay = daily.get(count);
  return days.map((day) => byDay?.get(day) ?? 0);
}

/** The chart's days: each feature's count on each window day. */
function buildActivityDays(
  daily: AdminOverviewSource["daily"],
  dayKeys: readonly string[],
): AdminActivityDay[] {
  const on = (feature: ActivityFeature, day: string) => daily.get(feature)?.get(day) ?? 0;
  return dayKeys.map((day) => ({
    day,
    [ACTIVITY_FEATURE.AGENTS_STARTED]: on(ACTIVITY_FEATURE.AGENTS_STARTED, day),
    [ACTIVITY_FEATURE.PLAN_REVISIONS]: on(ACTIVITY_FEATURE.PLAN_REVISIONS, day),
    [ACTIVITY_FEATURE.INBOX_ANSWERED]: on(ACTIVITY_FEATURE.INBOX_ANSWERED, day),
    [ACTIVITY_FEATURE.AUTOMATION_RUNS]: on(ACTIVITY_FEATURE.AUTOMATION_RUNS, day),
  }));
}

/** Every chart feature summed per day over the given keys. */
function activityTotals(daily: AdminOverviewSource["daily"], days: readonly string[]): number[] {
  const features = Object.values(ACTIVITY_FEATURE);
  return days.map((day) => sum(features.map((feature) => daily.get(feature)?.get(day) ?? 0)));
}

/** The daily count each origin but by hand is read under; by hand is what they leave. */
const ORIGIN_COUNT = {
  [AGENT_ORIGIN.AUTOMATION]: DAILY_COUNT.AGENTS_FROM_AUTOMATIONS,
  [AGENT_ORIGIN.SLACK]: DAILY_COUNT.AGENTS_FROM_SLACK,
  [AGENT_ORIGIN.AGENT]: DAILY_COUNT.AGENTS_FROM_AGENTS,
} as const satisfies Record<Exclude<AgentOrigin, typeof AGENT_ORIGIN.HAND>, DailyCount>;

/**
 * The recent run's agents started, split by origin. The queries count each
 * origin but by hand with the ones before it left out, so by hand is the rest
 * of every agent started, and the origins sum to the whole by construction.
 */
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

/** The ranked accounts with their counts joined, in the rank the query read them in. */
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

/**
 * Shapes the queried source into the overview. Every series is zero-filled
 * over the window's own day keys, and every trend is folded from the same
 * maps over the last two trend runs, so a 7-day view still compares against
 * the week before and a tile can never disagree with the bars under it.
 */
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
