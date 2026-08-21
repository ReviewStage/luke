import { and, count, desc, eq, gt, gte, isNull, ne, or, type SQL, sql, sum } from "drizzle-orm";
import type { createDatabase } from "../db/index.js";
import { account, session, user } from "../db/schema.js";
import { hostedUsage } from "../db/usage-schema.js";
import { HOSTED_DAILY_LIMIT, HOSTED_METER, utcDayKey } from "../hosted/quota.js";
import { USER_ROLE } from "./admin-access.js";
import {
  ADMIN_METRICS_WINDOW_DAYS,
  type AdminIntegration,
  type AdminMetricsSource,
  type AdminSignInMethods,
  type AdminTopUser,
  type AdminUsageDay,
  lastNDayKeys,
} from "./admin-metrics.js";
import { ADMIN_METRICS_SCOPE, type AdminMetricsScope } from "./http.js";

/** How many of the heaviest hosted-tier users the dashboard names. */
export const ADMIN_TOP_USERS_LIMIT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

type Database = ReturnType<typeof createDatabase>;

/**
 * The accounts a scope keeps. The default keeps every account whose role is not
 * admin — a null role predates the column's default and is an ordinary user, so
 * it stays — and `all` filters nothing. Every query below joins the user row it
 * counts through, so this one condition is the whole filter.
 */
function scopeCondition(scope: AdminMetricsScope): SQL<unknown> | undefined {
  if (scope === ADMIN_METRICS_SCOPE.ALL) return undefined;
  return or(ne(user.role, USER_ROLE.ADMIN), isNull(user.role));
}

/** Postgres returns a `count` as a number and a bigint `sum` as a string or null. */
function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function probeDatabase(
  database: Database,
): Promise<{ reachable: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  try {
    await database.execute(sql`select 1`);
    return { reachable: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { reachable: false, latencyMs: Date.now() - startedAt };
  }
}

async function readUserMetrics(
  database: Database,
  now: number,
  windowStart: Date,
  scope: AdminMetricsScope,
): Promise<AdminMetricsSource["users"]> {
  const dayExpression = sql<string>`to_char(${user.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const [
    [totalRow],
    [newLast7Row],
    [newLast30Row],
    [activeSessionRow],
    [activeSessionUsersRow],
    providerRows,
    signupRows,
  ] = await Promise.all([
    database.select({ value: count() }).from(user).where(scopeCondition(scope)),
    database
      .select({ value: count() })
      .from(user)
      .where(and(gte(user.createdAt, new Date(now - 7 * DAY_MS)), scopeCondition(scope))),
    database
      .select({ value: count() })
      .from(user)
      .where(and(gte(user.createdAt, new Date(now - 30 * DAY_MS)), scopeCondition(scope))),
    database
      .select({ value: count() })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(and(gt(session.expiresAt, new Date(now)), scopeCondition(scope))),
    database
      .select({ value: sql<number>`count(distinct ${session.userId})` })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(and(gt(session.expiresAt, new Date(now)), scopeCondition(scope))),
    database
      .select({ providerId: account.providerId, value: count() })
      .from(account)
      .innerJoin(user, eq(account.userId, user.id))
      .where(scopeCondition(scope))
      .groupBy(account.providerId),
    database
      .select({ day: dayExpression, value: count() })
      .from(user)
      .where(and(gte(user.createdAt, windowStart), scopeCondition(scope)))
      .groupBy(dayExpression),
  ]);

  const signInMethods: AdminSignInMethods = { google: 0, github: 0, other: 0 };
  for (const row of providerRows) {
    const value = toNumber(row.value);
    if (row.providerId === "google") signInMethods.google += value;
    else if (row.providerId === "github") signInMethods.github += value;
    else signInMethods.other += value;
  }

  const signupsByDay = new Map<string, number>();
  for (const row of signupRows) signupsByDay.set(row.day, toNumber(row.value));

  return {
    total: toNumber(totalRow?.value),
    newLast7Days: toNumber(newLast7Row?.value),
    newLast30Days: toNumber(newLast30Row?.value),
    activeSessions: toNumber(activeSessionRow?.value),
    activeSessionUsers: toNumber(activeSessionUsersRow?.value),
    signInMethods,
    signupsByDay,
  };
}

async function readUsageMetrics(
  database: Database,
  todayKey: string,
  windowStartDay: string,
  scope: AdminMetricsScope,
): Promise<AdminMetricsSource["usage"]> {
  const [usageRows, [activeTodayRow], topUserRows] = await Promise.all([
    database
      .select({
        day: hostedUsage.day,
        voiceCalls: sum(hostedUsage.voiceCalls),
        attentionReviews: sum(hostedUsage.attentionReviews),
      })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(and(gte(hostedUsage.day, windowStartDay), scopeCondition(scope)))
      .groupBy(hostedUsage.day),
    database
      .select({ value: count() })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(and(eq(hostedUsage.day, todayKey), scopeCondition(scope))),
    database
      .select({
        name: user.name,
        email: user.email,
        voiceCalls: sum(hostedUsage.voiceCalls),
        attentionReviews: sum(hostedUsage.attentionReviews),
      })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(and(gte(hostedUsage.day, windowStartDay), scopeCondition(scope)))
      .groupBy(user.id, user.name, user.email)
      .orderBy(desc(sql`sum(${hostedUsage.voiceCalls}) + sum(${hostedUsage.attentionReviews})`))
      .limit(ADMIN_TOP_USERS_LIMIT),
  ]);

  const byDay = new Map<string, AdminUsageDay>();
  for (const row of usageRows) {
    byDay.set(row.day, {
      voiceCalls: toNumber(row.voiceCalls),
      attentionReviews: toNumber(row.attentionReviews),
    });
  }

  const topUsers: AdminTopUser[] = topUserRows.map((row) => {
    const voiceCalls = toNumber(row.voiceCalls);
    const attentionReviews = toNumber(row.attentionReviews);
    return {
      name: row.name,
      email: row.email,
      voiceCalls,
      attentionReviews,
      total: voiceCalls + attentionReviews,
    };
  });

  return { byDay, activeUsersToday: toNumber(activeTodayRow?.value), topUsers };
}

/**
 * Either meter past its daily ceiling — the row a spend was refused on. The
 * spend that lands exactly on the limit is still allowed, and a refused
 * attempt still increments, so only a count strictly past the limit proves a
 * refusal happened.
 */
function ceilingReached(): SQL<unknown> | undefined {
  return or(
    gt(hostedUsage.voiceCalls, HOSTED_DAILY_LIMIT[HOSTED_METER.VOICE_CALL]),
    gt(hostedUsage.attentionReviews, HOSTED_DAILY_LIMIT[HOSTED_METER.ATTENTION_REVIEW]),
  );
}

async function readReliabilityMetrics(
  database: Database,
  todayKey: string,
  windowStartDay: string,
  scope: AdminMetricsScope,
): Promise<AdminMetricsSource["reliability"]> {
  const [[todayRow], [windowRow]] = await Promise.all([
    database
      .select({ value: count() })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(and(eq(hostedUsage.day, todayKey), ceilingReached(), scopeCondition(scope))),
    database
      .select({ value: count() })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(and(gte(hostedUsage.day, windowStartDay), ceilingReached(), scopeCondition(scope))),
  ]);

  return {
    quotaLimitedUserDaysToday: toNumber(todayRow?.value),
    quotaLimitedUserDaysWindow: toNumber(windowRow?.value),
  };
}

function emptySource(
  integrations: readonly AdminIntegration[],
  database: { reachable: boolean; latencyMs: number },
): AdminMetricsSource {
  return {
    users: {
      total: 0,
      newLast7Days: 0,
      newLast30Days: 0,
      activeSessions: 0,
      activeSessionUsers: 0,
      signInMethods: { google: 0, github: 0, other: 0 },
      signupsByDay: new Map(),
    },
    usage: { byDay: new Map(), activeUsersToday: 0, topUsers: [] },
    reliability: { quotaLimitedUserDaysToday: 0, quotaLimitedUserDaysWindow: 0 },
    systemHealth: { database, integrations },
  };
}

/**
 * Reads every aggregate the dashboard shows, from the service's own tables. A
 * database that does not answer the probe short-circuits to an empty source
 * whose health card reports the outage rather than a page of misleading zeros
 * with a green light — the integrations, read from the environment, still fill
 * in.
 */
export async function readAdminMetricsSource(
  database: Database,
  input: {
    now: number;
    integrations: readonly AdminIntegration[];
    scope: AdminMetricsScope;
  },
): Promise<AdminMetricsSource> {
  const health = await probeDatabase(database);
  if (!health.reachable) return emptySource(input.integrations, health);

  const dayKeys = lastNDayKeys(input.now, ADMIN_METRICS_WINDOW_DAYS);
  const windowStartDay = dayKeys[0] ?? utcDayKey(input.now);
  const todayKey = utcDayKey(input.now);
  const windowStart = new Date(`${windowStartDay}T00:00:00.000Z`);

  const [users, usage, reliability] = await Promise.all([
    readUserMetrics(database, input.now, windowStart, input.scope),
    readUsageMetrics(database, todayKey, windowStartDay, input.scope),
    readReliabilityMetrics(database, todayKey, windowStartDay, input.scope),
  ]);

  return {
    users,
    usage,
    reliability,
    systemHealth: { database: health, integrations: input.integrations },
  };
}
