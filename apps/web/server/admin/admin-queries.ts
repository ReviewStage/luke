import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  isNull,
  max,
  ne,
  or,
  type SQL,
  sql,
  sum,
} from "drizzle-orm";
import { adminFavorite } from "../db/favorite-schema.js";
import type { createDatabase } from "../db/index.js";
import { account, session, user } from "../db/schema.js";
import { hostedUsage } from "../db/usage-schema.js";
import { HOSTED_DAILY_LIMIT, HOSTED_METER, utcDayKey } from "../hosted/quota.js";
import { isAdminRole, USER_ROLE } from "./admin-access.js";
import {
  ADMIN_METRICS_WINDOW_DAYS,
  type AdminIntegration,
  type AdminMetricsSource,
  type AdminTopUser,
  type AdminUsageDay,
  countSignInMethods,
  lastNDayKeys,
} from "./admin-metrics.js";
import type { AdminUserSource } from "./admin-user.js";
import { ADMIN_USERS_LIMIT, type AdminUserListSource } from "./admin-users.js";
import { ADMIN_METRICS_SCOPE, type AdminMetricsScope } from "./http.js";

/** How many of the most active hosted-tier accounts the overview names. */
export const ADMIN_TOP_USERS_LIMIT = 10;

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
  const [[totalRow], [activeSessionRow], [activeSessionUsersRow], providerRows, signupRows] =
    await Promise.all([
      database.select({ value: count() }).from(user).where(scopeCondition(scope)),
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
      // Distinct pairs rather than a count of linked rows: the chart states
      // accounts per method, and an account can hold several rows of one
      // provider. The per-method counting itself lives in the fold below.
      database
        .selectDistinct({ userId: account.userId, providerId: account.providerId })
        .from(account)
        .innerJoin(user, eq(account.userId, user.id))
        .where(scopeCondition(scope)),
      database
        .select({ day: dayExpression, value: count() })
        .from(user)
        .where(and(gte(user.createdAt, windowStart), scopeCondition(scope)))
        .groupBy(dayExpression),
    ]);

  const signupsByDay = new Map<string, number>();
  for (const row of signupRows) signupsByDay.set(row.day, toNumber(row.value));

  return {
    total: toNumber(totalRow?.value),
    activeSessions: toNumber(activeSessionRow?.value),
    activeSessionUsers: toNumber(activeSessionUsersRow?.value),
    signInMethods: countSignInMethods(providerRows),
    signupsByDay,
  };
}

async function readUsageMetrics(
  database: Database,
  todayKey: string,
  windowStartDay: string,
  scope: AdminMetricsScope,
): Promise<AdminMetricsSource["usage"]> {
  const [usageRows, [activeTodayRow], [activeWindowRow], topUserRows] = await Promise.all([
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
    // Distinct rather than a row count: the window holds one row per account
    // per day, so counting rows would answer account-days, not accounts.
    database
      .select({ value: sql<number>`count(distinct ${hostedUsage.userId})` })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(and(gte(hostedUsage.day, windowStartDay), scopeCondition(scope))),
    // Ordered by days present before volume spent: the table asks who shows
    // up daily, and thirty quiet days outrank one heavy one. Volume breaks the
    // ties that a short window makes common.
    database
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        activeDays: count(),
        lastActiveDay: sql<string>`max(${hostedUsage.day})`,
        voiceCalls: sum(hostedUsage.voiceCalls),
        attentionReviews: sum(hostedUsage.attentionReviews),
      })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(and(gte(hostedUsage.day, windowStartDay), scopeCondition(scope)))
      .groupBy(user.id, user.name, user.email)
      .orderBy(
        desc(count()),
        desc(sql`sum(${hostedUsage.voiceCalls}) + sum(${hostedUsage.attentionReviews})`),
      )
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
      id: row.id,
      name: row.name,
      email: row.email,
      activeDays: toNumber(row.activeDays),
      lastActiveDay: row.lastActiveDay,
      voiceCalls,
      attentionReviews,
      total: voiceCalls + attentionReviews,
    };
  });

  return {
    byDay,
    activeUsersToday: toNumber(activeTodayRow?.value),
    activeUsersWindow: toNumber(activeWindowRow?.value),
    topUsers,
  };
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
  analyticsConsoleUrl: string | undefined,
): AdminMetricsSource {
  return {
    users: {
      total: 0,
      activeSessions: 0,
      activeSessionUsers: 0,
      signInMethods: { google: 0, github: 0, other: 0 },
      signupsByDay: new Map(),
    },
    usage: { byDay: new Map(), activeUsersToday: 0, activeUsersWindow: 0, topUsers: [] },
    reliability: {
      quotaLimitedUserDaysToday: 0,
      quotaLimitedUserDaysWindow: 0,
      analyticsConsoleUrl,
    },
    systemHealth: { database, integrations },
  };
}

/**
 * Reads every aggregate the dashboard shows, from the service's own tables. A
 * database that does not answer the probe short-circuits to an empty source
 * whose health card reports the outage rather than a page of misleading zeros
 * with a green light — the integrations and the analytics console address,
 * read from the environment, still fill in.
 */
export async function readAdminMetricsSource(
  database: Database,
  input: {
    now: number;
    integrations: readonly AdminIntegration[];
    analyticsConsoleUrl?: string;
    scope: AdminMetricsScope;
  },
): Promise<AdminMetricsSource> {
  const health = await probeDatabase(database);
  if (!health.reachable) return emptySource(input.integrations, health, input.analyticsConsoleUrl);

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
    reliability: { ...reliability, analyticsConsoleUrl: input.analyticsConsoleUrl },
    systemHealth: { database: health, integrations: input.integrations },
  };
}

/**
 * Reads everything one account's page shows, or nothing when no user row
 * carries the id. No probe and no empty fallback here: the detail page has no
 * health card to report an outage on, so a database that does not answer is
 * left to throw and become the handler's 503, where the metrics read instead
 * degrades to a page that can say so.
 */
export async function readAdminUserSource(
  database: Database,
  input: { userId: string; now: number },
): Promise<AdminUserSource | undefined> {
  const dayKeys = lastNDayKeys(input.now, ADMIN_METRICS_WINDOW_DAYS);
  const windowStartDay = dayKeys[0] ?? utcDayKey(input.now);

  const [userRows, accountRows, windowRows, [allTimeRow], [quotaRow]] = await Promise.all([
    database
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1),
    database
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, input.userId)),
    database
      .select({
        day: hostedUsage.day,
        voiceCalls: hostedUsage.voiceCalls,
        attentionReviews: hostedUsage.attentionReviews,
      })
      .from(hostedUsage)
      .where(and(eq(hostedUsage.userId, input.userId), gte(hostedUsage.day, windowStartDay))),
    database
      .select({
        activeDays: count(),
        firstActiveDay: sql<string | null>`min(${hostedUsage.day})`,
        lastActiveDay: sql<string | null>`max(${hostedUsage.day})`,
        voiceCalls: sum(hostedUsage.voiceCalls),
        attentionReviews: sum(hostedUsage.attentionReviews),
      })
      .from(hostedUsage)
      .where(eq(hostedUsage.userId, input.userId)),
    database
      .select({ value: count() })
      .from(hostedUsage)
      .where(
        and(
          eq(hostedUsage.userId, input.userId),
          gte(hostedUsage.day, windowStartDay),
          ceilingReached(),
        ),
      ),
  ]);

  const row = userRows[0];
  if (!row) return undefined;

  const byDay = new Map<string, AdminUsageDay>();
  for (const usageRow of windowRows) {
    byDay.set(usageRow.day, {
      voiceCalls: usageRow.voiceCalls,
      attentionReviews: usageRow.attentionReviews,
    });
  }

  return {
    account: {
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      admin: isAdminRole(row.role),
      createdAt: row.createdAt.getTime(),
      signInMethods: accountRows.map((linked) => linked.providerId),
    },
    usage: {
      byDay,
      allTime: {
        activeDays: toNumber(allTimeRow?.activeDays),
        firstActiveDay: allTimeRow?.firstActiveDay ?? null,
        lastActiveDay: allTimeRow?.lastActiveDay ?? null,
        voiceCalls: toNumber(allTimeRow?.voiceCalls),
        attentionReviews: toNumber(allTimeRow?.attentionReviews),
      },
      quotaLimitedDaysWindow: toNumber(quotaRow?.value),
    },
  };
}

/**
 * Reads the whole account roster with each account's window aggregates. The
 * usage rows arrive through a left join carrying the window bound in its own
 * condition, so an account that never touched the hosted tier is still a row
 * — with zero active days and no last-active day — instead of vanishing the
 * way it does from every inner-joined aggregate above. Most recently active
 * first, the never-active tail ordered by youngest account, and the roster
 * cut at the stated bound while `total` still counts everyone. Last-seen
 * instants ride a query of their own: a second one-to-many join would fan
 * the usage aggregates out across each account's session rows.
 */
export async function readAdminUsersSource(
  database: Database,
  input: { now: number; scope: AdminMetricsScope; viewerId: string },
): Promise<AdminUserListSource> {
  const dayKeys = lastNDayKeys(input.now, ADMIN_METRICS_WINDOW_DAYS);
  const windowStartDay = dayKeys[0] ?? utcDayKey(input.now);

  const [[totalRow], lastSeenRows, rows] = await Promise.all([
    database.select({ value: count() }).from(user).where(scopeCondition(input.scope)),
    database
      .select({ userId: session.userId, lastSeenAt: max(session.updatedAt) })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(scopeCondition(input.scope))
      .groupBy(session.userId),
    database
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        createdAt: user.createdAt,
        activeDays: sql<number | string | null>`count(${hostedUsage.day})`,
        lastActiveDay: sql<string | null>`max(${hostedUsage.day})`,
        voiceCalls: sum(hostedUsage.voiceCalls),
        attentionReviews: sum(hostedUsage.attentionReviews),
        // At most one star row joins per account, so aggregating its presence
        // leaves the usage aggregates' fan-out untouched.
        favorite: sql<boolean>`bool_or(${adminFavorite.adminId} is not null)`,
      })
      .from(user)
      .leftJoin(
        hostedUsage,
        and(eq(hostedUsage.userId, user.id), gte(hostedUsage.day, windowStartDay)),
      )
      .leftJoin(
        adminFavorite,
        and(eq(adminFavorite.userId, user.id), eq(adminFavorite.adminId, input.viewerId)),
      )
      .where(scopeCondition(input.scope))
      .groupBy(user.id, user.name, user.email, user.image, user.role, user.createdAt)
      .orderBy(sql`max(${hostedUsage.day}) desc nulls last`, desc(user.createdAt))
      .limit(ADMIN_USERS_LIMIT),
  ]);

  const lastSeenByUser = new Map<string, Date>();
  for (const seen of lastSeenRows) {
    if (seen.lastSeenAt) lastSeenByUser.set(seen.userId, seen.lastSeenAt);
  }

  return {
    total: toNumber(totalRow?.value),
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      admin: isAdminRole(row.role),
      createdAt: row.createdAt.getTime(),
      activeDays: toNumber(row.activeDays),
      lastActiveDay: row.lastActiveDay,
      lastSeenAt: lastSeenByUser.get(row.id)?.getTime() ?? null,
      voiceCalls: toNumber(row.voiceCalls),
      attentionReviews: toNumber(row.attentionReviews),
      favorite: row.favorite === true,
    })),
  };
}

/**
 * Sets whether one admin favorites one account, answering whether the account
 * exists at all: a press on a roster the account has since left should read as
 * the account being gone, not the write landing nowhere. Both writes land
 * twice without complaint — the star's presence is the whole state.
 */
export async function writeAdminFavorite(
  database: Database,
  input: { adminId: string; userId: string; favorite: boolean },
): Promise<boolean> {
  const [target] = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (!target) return false;

  if (input.favorite) {
    await database
      .insert(adminFavorite)
      .values({ adminId: input.adminId, userId: input.userId })
      .onConflictDoNothing();
  } else {
    await database
      .delete(adminFavorite)
      .where(and(eq(adminFavorite.adminId, input.adminId), eq(adminFavorite.userId, input.userId)));
  }
  return true;
}
