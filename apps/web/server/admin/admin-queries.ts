import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
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
import { ADMIN_DAY_ACCOUNTS_LIMIT, type AdminDaySource } from "./admin-day.js";
import {
  ADMIN_RETENTION_WEEKS,
  type AdminIntegration,
  type AdminMetricsSource,
  type AdminTopUser,
  type AdminUsageDay,
  countSignInMethods,
  lastNDayKeys,
  lastNWeekStartKeys,
  utcWeekStartKey,
  windowFetchDays,
} from "./admin-metrics.js";
import type { AdminUserSource } from "./admin-user.js";
import { ADMIN_USERS_LIMIT, type AdminUserListSource, searchLikePattern } from "./admin-users.js";
import { ADMIN_METRICS_SCOPE, type AdminMetricsScope, type AdminMetricsWindow } from "./http.js";

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

/**
 * The accounts a search keeps: a case-insensitive substring of the name or
 * the email, the two fields a roster row is found by. The term travels as a
 * bound parameter — never interpolated into the SQL — with its own
 * wildcards escaped, so it can only ever name characters to find.
 */
function searchCondition(search: string | undefined): SQL<unknown> | undefined {
  if (search === undefined) return undefined;
  const pattern = searchLikePattern(search);
  return or(ilike(user.name, pattern), ilike(user.email, pattern));
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
  fetchStart: Date,
  scope: AdminMetricsScope,
): Promise<AdminMetricsSource["users"]> {
  const dayExpression = sql<string>`to_char(${user.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const [[totalRow], providerRows, signupRows] = await Promise.all([
    database.select({ value: count() }).from(user).where(scopeCondition(scope)),
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
      .where(and(gte(user.createdAt, fetchStart), scopeCondition(scope)))
      .groupBy(dayExpression),
  ]);

  const signupsByDay = new Map<string, number>();
  for (const row of signupRows) signupsByDay.set(row.day, toNumber(row.value));

  return {
    total: toNumber(totalRow?.value),
    signInMethods: countSignInMethods(providerRows),
    signupsByDay,
  };
}

async function readUsageMetrics(
  database: Database,
  todayKey: string,
  windowStartDay: string,
  fetchStartDay: string,
  scope: AdminMetricsScope,
): Promise<AdminMetricsSource["usage"]> {
  const [usageRows, [activeTodayRow], [activeWindowRow], topUserRows] = await Promise.all([
    // The daily rows alone read from the wider fetch bound: the builder's
    // trends need both of their runs even when the window is shorter, while
    // every windowed aggregate below stays on the window's own bound.
    database
      .select({
        day: hostedUsage.day,
        voiceCalls: sum(hostedUsage.voiceCalls),
        attentionReviews: sum(hostedUsage.attentionReviews),
      })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(and(gte(hostedUsage.day, fetchStartDay), scopeCondition(scope)))
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
        image: user.image,
        role: user.role,
        activeDays: count(),
        lastActiveDay: sql<string>`max(${hostedUsage.day})`,
        voiceCalls: sum(hostedUsage.voiceCalls),
        attentionReviews: sum(hostedUsage.attentionReviews),
      })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(and(gte(hostedUsage.day, windowStartDay), scopeCondition(scope)))
      .groupBy(user.id, user.name, user.email, user.image, user.role)
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
      image: row.image,
      admin: isAdminRole(row.role),
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
 * Both week expressions truncate with Postgres's `date_trunc('week')`, which
 * lands on Monday — the same Monday `utcWeekStartKey` derives — so the SQL
 * and the fold name a week identically. A signup instant is a timestamp and
 * a usage day a YYYY-MM-DD string, hence the two shapes of the same cast.
 */
const signupWeek = sql<string>`to_char(date_trunc('week', ${user.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
const activityWeek = sql<string>`to_char(date_trunc('week', ${hostedUsage.day}::date), 'YYYY-MM-DD')`;

async function readRetentionMetrics(
  database: Database,
  now: number,
  scope: AdminMetricsScope,
): Promise<AdminMetricsSource["retention"]> {
  const weekKeys = lastNWeekStartKeys(now, ADMIN_RETENTION_WEEKS);
  const oldestWeekStartDay = weekKeys[0] ?? utcWeekStartKey(now);
  const oldestWeekStart = new Date(`${oldestWeekStartDay}T00:00:00.000Z`);

  const [sizeRows, activeRows] = await Promise.all([
    database
      .select({ week: signupWeek, value: count() })
      .from(user)
      .where(and(gte(user.createdAt, oldestWeekStart), scopeCondition(scope)))
      .groupBy(signupWeek),
    // Distinct accounts per (signup week, activity week) pair: a cohort
    // member with several active days in one week is retained once, not
    // once per day.
    database
      .select({
        signupWeek,
        activityWeek,
        value: sql<number>`count(distinct ${hostedUsage.userId})`,
      })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(
        and(
          gte(user.createdAt, oldestWeekStart),
          gte(hostedUsage.day, oldestWeekStartDay),
          scopeCondition(scope),
        ),
      )
      .groupBy(signupWeek, activityWeek),
  ]);

  const cohortSizes = new Map<string, number>();
  for (const row of sizeRows) cohortSizes.set(row.week, toNumber(row.value));

  const activeByCohortWeek = new Map<string, Map<string, number>>();
  for (const row of activeRows) {
    const byWeek = activeByCohortWeek.get(row.signupWeek) ?? new Map<string, number>();
    byWeek.set(row.activityWeek, toNumber(row.value));
    activeByCohortWeek.set(row.signupWeek, byWeek);
  }

  return { cohortSizes, activeByCohortWeek };
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
      signInMethods: { google: 0, github: 0, other: 0 },
      signupsByDay: new Map(),
    },
    usage: { byDay: new Map(), activeUsersToday: 0, activeUsersWindow: 0, topUsers: [] },
    retention: { cohortSizes: new Map(), activeByCohortWeek: new Map() },
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
    windowDays: AdminMetricsWindow;
  },
): Promise<AdminMetricsSource> {
  const health = await probeDatabase(database);
  if (!health.reachable) return emptySource(input.integrations, health, input.analyticsConsoleUrl);

  const windowStartDay = lastNDayKeys(input.now, input.windowDays)[0] ?? utcDayKey(input.now);
  const fetchStartDay =
    lastNDayKeys(input.now, windowFetchDays(input.windowDays))[0] ?? utcDayKey(input.now);
  const todayKey = utcDayKey(input.now);
  const fetchStart = new Date(`${fetchStartDay}T00:00:00.000Z`);

  const [users, usage, retention, reliability] = await Promise.all([
    readUserMetrics(database, fetchStart, input.scope),
    readUsageMetrics(database, todayKey, windowStartDay, fetchStartDay, input.scope),
    readRetentionMetrics(database, input.now, input.scope),
    readReliabilityMetrics(database, todayKey, windowStartDay, input.scope),
  ]);

  return {
    users,
    usage,
    retention,
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
  input: { userId: string; now: number; windowDays: AdminMetricsWindow },
): Promise<AdminUserSource | undefined> {
  const windowStartDay = lastNDayKeys(input.now, input.windowDays)[0] ?? utcDayKey(input.now);
  // The daily rows read from the wider bound so the builder's trends hold
  // both runs; the throttle count below stays on the window's own.
  const fetchStartDay =
    lastNDayKeys(input.now, windowFetchDays(input.windowDays))[0] ?? utcDayKey(input.now);

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
      .where(and(eq(hostedUsage.userId, input.userId), gte(hostedUsage.day, fetchStartDay))),
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
 * Reads one UTC day's active accounts with the day's totals. The usage table
 * holds one row per account per day, so each bounded row is already the
 * account's whole day and needs no aggregation; the totals ride their own
 * aggregate read because the rows are cut at the bound. Busiest first, with
 * voice breaking ties so equal days keep a stable order across refreshes.
 * Like the account detail, this has no probe and no empty fallback: a
 * database that does not answer throws into the handler's 503.
 */
export async function readAdminDaySource(
  database: Database,
  input: { day: string; scope: AdminMetricsScope },
): Promise<AdminDaySource> {
  const kept = and(eq(hostedUsage.day, input.day), scopeCondition(input.scope));

  const [accountRows, [totalsRow]] = await Promise.all([
    database
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        voiceCalls: hostedUsage.voiceCalls,
        attentionReviews: hostedUsage.attentionReviews,
      })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(kept)
      .orderBy(
        desc(sql`${hostedUsage.voiceCalls} + ${hostedUsage.attentionReviews}`),
        desc(hostedUsage.voiceCalls),
      )
      .limit(ADMIN_DAY_ACCOUNTS_LIMIT),
    database
      .select({
        accounts: count(),
        voiceCalls: sum(hostedUsage.voiceCalls),
        attentionReviews: sum(hostedUsage.attentionReviews),
      })
      .from(hostedUsage)
      .innerJoin(user, eq(hostedUsage.userId, user.id))
      .where(kept),
  ]);

  return {
    accounts: accountRows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      admin: isAdminRole(row.role),
      voiceCalls: row.voiceCalls,
      attentionReviews: row.attentionReviews,
      total: row.voiceCalls + row.attentionReviews,
    })),
    totals: {
      accounts: toNumber(totalsRow?.accounts),
      voiceCalls: toNumber(totalsRow?.voiceCalls),
      attentionReviews: toNumber(totalsRow?.attentionReviews),
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
 * cut at the stated bound while `total` still counts everyone. A search
 * narrows the rows and the total alike, so a truncated answer still states
 * how many accounts match. Last-seen
 * instants ride a query of their own: a second one-to-many join would fan
 * the usage aggregates out across each account's session rows.
 */
export async function readAdminUsersSource(
  database: Database,
  input: {
    now: number;
    scope: AdminMetricsScope;
    search: string | undefined;
    viewerId: string;
    windowDays: AdminMetricsWindow;
  },
): Promise<AdminUserListSource> {
  const windowStartDay = lastNDayKeys(input.now, input.windowDays)[0] ?? utcDayKey(input.now);
  const kept = and(scopeCondition(input.scope), searchCondition(input.search));

  const [[totalRow], lastSeenRows, rows] = await Promise.all([
    database.select({ value: count() }).from(user).where(kept),
    database
      .select({ userId: session.userId, lastSeenAt: max(session.updatedAt) })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(kept)
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
      .where(kept)
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
