import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Duration, Effect, Either, Option, type ParseResult, Schema } from "effect";
import { HOSTED_DAILY_LIMIT, utcDayKey } from "../hosted/quota.js";
import { isAdminRole, USER_ROLE } from "./admin-access.js";
import { ADMIN_DAY_ACCOUNTS_LIMIT, type AdminDaySource } from "./admin-day.js";
import {
  ADMIN_RETENTION_WEEKS,
  type AdminIntegration,
  type AdminMetricsSource,
  type AdminTopUser,
  countSignInMethods,
  lastNDayKeys,
  lastNWeekStartKeys,
  utcWeekStartKey,
  windowFetchDays,
} from "./admin-metrics.js";
import { type AdminUserSource, calendarDayKeys } from "./admin-user.js";
import {
  ADMIN_USERS_LIMIT,
  type AdminUserListSource,
  lastSeenInstant,
  searchLikePattern,
} from "./admin-users.js";
import { ADMIN_METRICS_SCOPE, type AdminMetricsScope, type AdminMetricsWindow } from "./http.js";

/** How many of the most active hosted-tier accounts the overview names. */
const ADMIN_TOP_USERS_LIMIT = 10;

type AdminQueryFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E, R = never>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

/**
 * An aggregate as the two drivers hand it back: `count` and `sum` answer a
 * bigint, which `pg` reads as a string because a 64-bit value need not fit a
 * JS number, while PGlite parses it to one. Every aggregate here counts rows
 * or sums a day's calls, well inside the safe integer range, so both readings
 * decode to the same number. A `sum` over no rows is null, which is the zero
 * the dashboard shows.
 */
const AggregateColumnSchema = Schema.Union(Schema.Number, Schema.NumberFromString);
const NullableAggregateColumnSchema = Schema.NullOr(AggregateColumnSchema);

const CountRowSchema = Schema.Struct({ value: AggregateColumnSchema });

const AdminMetricsScopeSchema = Schema.Literal(
  ADMIN_METRICS_SCOPE.NON_ADMINS,
  ADMIN_METRICS_SCOPE.ALL,
);

/**
 * The accounts a scope keeps. The default keeps every account whose role is not
 * admin — a null role predates the column's default and is an ordinary user, so
 * it stays — and `all` filters nothing. Every joined query below counts through
 * a user row, so this one condition is the whole filter.
 */
function keptByScope(sql: SqlClient.SqlClient, scope: AdminMetricsScope) {
  return scope === ADMIN_METRICS_SCOPE.ALL
    ? sql`true`
    : sql`("user".role <> ${USER_ROLE.ADMIN} or "user".role is null)`;
}

/** A `count` row a query always answers with, or the zero an absent row means. */
const countOf = Option.match({ onNone: () => 0, onSome: (row: { value: number }) => row.value });

/** Postgres returns a `count` as a number and a bigint `sum` as a string or null. */
function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Whether the database answers at all, and how long it took. A failure is the
 * answer rather than the read's, because the health card is what reports it.
 */
const probeDatabase = Effect.map(
  Effect.timed(Effect.either(statement((sql) => sql`select 1`))),
  ([elapsed, probed]) => ({
    reachable: Either.isRight(probed),
    latencyMs: Math.round(Duration.toMillis(elapsed)),
  }),
);

const findUserTotal = SqlSchema.findOne({
  Request: AdminMetricsScopeSchema,
  Result: Schema.Struct({ value: AggregateColumnSchema }),
  execute: (scope) =>
    statement((sql) => sql`select count(*) as value from "user" where ${keptByScope(sql, scope)}`),
});

const SignInLinkRowSchema = Schema.Struct({
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  providerId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("provider_id")),
});

/**
 * Distinct pairs rather than a count of linked rows: the chart states
 * accounts per method, and an account can hold several rows of one provider.
 * The per-method counting itself lives in the fold below.
 */
const findSignInLinks = SqlSchema.findAll({
  Request: AdminMetricsScopeSchema,
  Result: SignInLinkRowSchema,
  execute: (scope) =>
    statement(
      (sql) => sql`
        select distinct account.user_id, account.provider_id
        from account
        inner join "user" on "user".id = account.user_id
        where ${keptByScope(sql, scope)}
      `,
    ),
});

const DayCountRowSchema = Schema.Struct({ day: Schema.String, value: AggregateColumnSchema });

const findSignupsByDay = SqlSchema.findAll({
  Request: Schema.Struct({ fetchStart: Schema.DateFromSelf, scope: AdminMetricsScopeSchema }),
  Result: DayCountRowSchema,
  execute: (request) =>
    statement((sql) => {
      const day = sql`to_char("user".created_at at time zone 'UTC', 'YYYY-MM-DD')`;
      return sql`
        select ${day} as day, count(*) as value
        from "user"
        where "user".created_at >= ${request.fetchStart} and ${keptByScope(sql, request.scope)}
        group by ${day}
      `;
    }),
});

function readUserMetrics(
  fetchStart: Date,
  scope: AdminMetricsScope,
): Effect.Effect<AdminMetricsSource["users"], AdminQueryFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const [total, links, signups] = yield* Effect.all(
      [findUserTotal(scope), findSignInLinks(scope), findSignupsByDay({ fetchStart, scope })],
      { concurrency: "unbounded" },
    );

    const signupsByDay = new Map<string, number>();
    for (const row of signups) signupsByDay.set(row.day, row.value);

    return {
      total: Option.match(total, { onNone: () => 0, onSome: (row) => row.value }),
      signInMethods: countSignInMethods(links),
      signupsByDay,
    };
  });
}

const DaySumRowSchema = Schema.Struct({
  day: Schema.String,
  calls: NullableAggregateColumnSchema,
});

/**
 * The daily rows alone read from the wider fetch bound: the builder's trends
 * need both of their runs even when the window is shorter, while every
 * windowed aggregate below stays on the window's own bound.
 */
const findUsageByDay = SqlSchema.findAll({
  Request: Schema.Struct({ fetchStartDay: Schema.String, scope: AdminMetricsScopeSchema }),
  Result: DaySumRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select hosted_usage.day as day, sum(hosted_usage.calls) as calls
        from hosted_usage
        inner join "user" on "user".id = hosted_usage.user_id
        where hosted_usage.day >= ${request.fetchStartDay} and ${keptByScope(sql, request.scope)}
        group by hosted_usage.day
      `,
    ),
});

const findActiveUsersOnDay = SqlSchema.findOne({
  Request: Schema.Struct({ day: Schema.String, scope: AdminMetricsScopeSchema }),
  Result: CountRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select count(*) as value
        from hosted_usage
        inner join "user" on "user".id = hosted_usage.user_id
        where hosted_usage.day = ${request.day} and ${keptByScope(sql, request.scope)}
      `,
    ),
});

/**
 * Distinct rather than a row count: the window holds one row per account per
 * day, so counting rows would answer account-days, not accounts.
 */
const findActiveUsersInWindow = SqlSchema.findOne({
  Request: Schema.Struct({ windowStartDay: Schema.String, scope: AdminMetricsScopeSchema }),
  Result: CountRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select count(distinct hosted_usage.user_id) as value
        from hosted_usage
        inner join "user" on "user".id = hosted_usage.user_id
        where hosted_usage.day >= ${request.windowStartDay} and ${keptByScope(sql, request.scope)}
      `,
    ),
});

const TopUserRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.String),
  activeDays: Schema.propertySignature(AggregateColumnSchema).pipe(Schema.fromKey("active_days")),
  lastActiveDay: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("last_active_day")),
  calls: NullableAggregateColumnSchema,
});

/**
 * Ordered by days present before volume spent: the table asks who shows up
 * daily, and thirty quiet days outrank one heavy one. Volume breaks the ties
 * that a short window makes common.
 */
const findTopUsers = SqlSchema.findAll({
  Request: Schema.Struct({ windowStartDay: Schema.String, scope: AdminMetricsScopeSchema }),
  Result: TopUserRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select
          "user".id,
          "user".name,
          "user".email,
          "user".image,
          "user".role,
          count(*) as active_days,
          max(hosted_usage.day) as last_active_day,
          sum(hosted_usage.calls) as calls
        from hosted_usage
        inner join "user" on "user".id = hosted_usage.user_id
        where hosted_usage.day >= ${request.windowStartDay} and ${keptByScope(sql, request.scope)}
        group by "user".id, "user".name, "user".email, "user".image, "user".role
        order by count(*) desc, sum(hosted_usage.calls) desc
        limit ${ADMIN_TOP_USERS_LIMIT}
      `,
    ),
});

function readUsageMetrics(
  todayKey: string,
  windowStartDay: string,
  fetchStartDay: string,
  scope: AdminMetricsScope,
): Effect.Effect<AdminMetricsSource["usage"], AdminQueryFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const [usageRows, activeToday, activeWindow, topUserRows] = yield* Effect.all(
      [
        findUsageByDay({ fetchStartDay, scope }),
        findActiveUsersOnDay({ day: todayKey, scope }),
        findActiveUsersInWindow({ windowStartDay, scope }),
        findTopUsers({ windowStartDay, scope }),
      ],
      { concurrency: "unbounded" },
    );

    const byDay = new Map<string, number>();
    for (const row of usageRows) byDay.set(row.day, toNumber(row.calls));

    const topUsers: AdminTopUser[] = topUserRows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      admin: isAdminRole(row.role),
      activeDays: row.activeDays,
      lastActiveDay: row.lastActiveDay,
      calls: toNumber(row.calls),
    }));

    const countOf = Option.match({
      onNone: () => 0,
      onSome: (row: { value: number }) => row.value,
    });

    return {
      byDay,
      activeUsersToday: countOf(activeToday),
      activeUsersWindow: countOf(activeWindow),
      topUsers,
    };
  });
}

/**
 * Both week expressions truncate with Postgres's `date_trunc('week')`, which
 * lands on Monday — the same Monday `utcWeekStartKey` derives — so the SQL
 * and the fold name a week identically. A signup instant is a timestamp and
 * a usage day a YYYY-MM-DD string, hence the two shapes of the same cast.
 */
const signupWeek = (sql: SqlClient.SqlClient) =>
  sql`to_char(date_trunc('week', "user".created_at at time zone 'UTC'), 'YYYY-MM-DD')`;
const activityWeek = (sql: SqlClient.SqlClient) =>
  sql`to_char(date_trunc('week', hosted_usage.day::date), 'YYYY-MM-DD')`;

const CohortSizeRowSchema = Schema.Struct({
  week: Schema.String,
  value: AggregateColumnSchema,
});

const findCohortSizes = SqlSchema.findAll({
  Request: Schema.Struct({ oldestWeekStart: Schema.DateFromSelf, scope: AdminMetricsScopeSchema }),
  Result: CohortSizeRowSchema,
  execute: (request) =>
    statement((sql) => {
      const week = signupWeek(sql);
      return sql`
        select ${week} as week, count(*) as value
        from "user"
        where "user".created_at >= ${request.oldestWeekStart}
          and ${keptByScope(sql, request.scope)}
        group by ${week}
      `;
    }),
});

const CohortActivityRowSchema = Schema.Struct({
  signupWeek: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("signup_week")),
  activityWeek: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("activity_week")),
  value: AggregateColumnSchema,
});

/**
 * Distinct accounts per (signup week, activity week) pair: a cohort member
 * with several active days in one week is retained once, not once per day.
 */
const findCohortActivity = SqlSchema.findAll({
  Request: Schema.Struct({
    oldestWeekStart: Schema.DateFromSelf,
    oldestWeekStartDay: Schema.String,
    scope: AdminMetricsScopeSchema,
  }),
  Result: CohortActivityRowSchema,
  execute: (request) =>
    statement((sql) => {
      const signup = signupWeek(sql);
      const activity = activityWeek(sql);
      return sql`
        select
          ${signup} as signup_week,
          ${activity} as activity_week,
          count(distinct hosted_usage.user_id) as value
        from hosted_usage
        inner join "user" on "user".id = hosted_usage.user_id
        where "user".created_at >= ${request.oldestWeekStart}
          and hosted_usage.day >= ${request.oldestWeekStartDay}
          and ${keptByScope(sql, request.scope)}
        group by ${signup}, ${activity}
      `;
    }),
});

function readRetentionMetrics(
  now: number,
  scope: AdminMetricsScope,
): Effect.Effect<AdminMetricsSource["retention"], AdminQueryFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const weekKeys = lastNWeekStartKeys(now, ADMIN_RETENTION_WEEKS);
    const oldestWeekStartDay = weekKeys[0] ?? utcWeekStartKey(now);
    const oldestWeekStart = new Date(`${oldestWeekStartDay}T00:00:00.000Z`);

    const [sizeRows, activeRows] = yield* Effect.all(
      [
        findCohortSizes({ oldestWeekStart, scope }),
        findCohortActivity({ oldestWeekStart, oldestWeekStartDay, scope }),
      ],
      { concurrency: "unbounded" },
    );

    const cohortSizes = new Map<string, number>();
    for (const row of sizeRows) cohortSizes.set(row.week, row.value);

    const activeByCohortWeek = new Map<string, Map<string, number>>();
    for (const row of activeRows) {
      const byWeek = activeByCohortWeek.get(row.signupWeek) ?? new Map<string, number>();
      byWeek.set(row.activityWeek, row.value);
      activeByCohortWeek.set(row.signupWeek, byWeek);
    }

    return { cohortSizes, activeByCohortWeek };
  });
}

/**
 * The counter past its daily ceiling — the row a spend was refused on. The
 * spend that lands exactly on the limit is still allowed, and a refused
 * attempt still increments, so only a count strictly past the limit proves a
 * refusal happened.
 */

function ceilingReached(sql: SqlClient.SqlClient) {
  return sql`hosted_usage.calls > ${HOSTED_DAILY_LIMIT}`;
}

const findQuotaLimitedOnDay = SqlSchema.findOne({
  Request: Schema.Struct({ day: Schema.String, scope: AdminMetricsScopeSchema }),
  Result: CountRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select count(*) as value
        from hosted_usage
        inner join "user" on "user".id = hosted_usage.user_id
        where hosted_usage.day = ${request.day}
          and ${ceilingReached(sql)}
          and ${keptByScope(sql, request.scope)}
      `,
    ),
});

const findQuotaLimitedInWindow = SqlSchema.findOne({
  Request: Schema.Struct({ windowStartDay: Schema.String, scope: AdminMetricsScopeSchema }),
  Result: CountRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select count(*) as value
        from hosted_usage
        inner join "user" on "user".id = hosted_usage.user_id
        where hosted_usage.day >= ${request.windowStartDay}
          and ${ceilingReached(sql)}
          and ${keptByScope(sql, request.scope)}
      `,
    ),
});

function readReliabilityMetrics(
  todayKey: string,
  windowStartDay: string,
  scope: AdminMetricsScope,
): Effect.Effect<
  Omit<AdminMetricsSource["reliability"], "analyticsConsoleUrl">,
  AdminQueryFailure,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const [today, window] = yield* Effect.all(
      [
        findQuotaLimitedOnDay({ day: todayKey, scope }),
        findQuotaLimitedInWindow({ windowStartDay, scope }),
      ],
      { concurrency: "unbounded" },
    );
    const countOf = Option.match({
      onNone: () => 0,
      onSome: (row: { value: number }) => row.value,
    });
    return {
      quotaLimitedUserDaysToday: countOf(today),
      quotaLimitedUserDaysWindow: countOf(window),
    };
  });
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
export function readAdminMetricsSource(input: {
  now: number;
  integrations: readonly AdminIntegration[];
  analyticsConsoleUrl?: string | undefined;
  scope: AdminMetricsScope;
  windowDays: AdminMetricsWindow;
}): Effect.Effect<AdminMetricsSource, AdminQueryFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const health = yield* probeDatabase;
    if (!health.reachable) {
      return emptySource(input.integrations, health, input.analyticsConsoleUrl);
    }

    const windowStartDay = lastNDayKeys(input.now, input.windowDays)[0] ?? utcDayKey(input.now);
    const fetchStartDay =
      lastNDayKeys(input.now, windowFetchDays(input.windowDays))[0] ?? utcDayKey(input.now);
    const todayKey = utcDayKey(input.now);
    const fetchStart = new Date(`${fetchStartDay}T00:00:00.000Z`);

    const [users, usage, retention, reliability] = yield* Effect.all(
      [
        readUserMetrics(fetchStart, input.scope),
        readUsageMetrics(todayKey, windowStartDay, fetchStartDay, input.scope),
        readRetentionMetrics(input.now, input.scope),
        readReliabilityMetrics(todayKey, windowStartDay, input.scope),
      ],
      { concurrency: "unbounded" },
    );

    return {
      users,
      usage,
      retention,
      reliability: { ...reliability, analyticsConsoleUrl: input.analyticsConsoleUrl },
      systemHealth: { database: health, integrations: input.integrations },
    };
  });
}

const AccountRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.String),
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("created_at")),
});

const findAccount = SqlSchema.findOne({
  Request: Schema.String,
  Result: AccountRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select id, name, email, image, role, created_at
        from "user"
        where id = ${userId}
        limit 1
      `,
    ),
});

const findSignInMethods = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    providerId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("provider_id")),
  }),
  execute: (userId) =>
    statement((sql) => sql`select provider_id from account where user_id = ${userId}`),
});

const findUsageSince = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, sinceDay: Schema.String }),
  Result: Schema.Struct({ day: Schema.String, calls: AggregateColumnSchema }),
  execute: (request) =>
    statement(
      (sql) => sql`
        select day, calls
        from hosted_usage
        where user_id = ${request.userId} and day >= ${request.sinceDay}
      `,
    ),
});

const findAllTimeUsage = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({
    activeDays: Schema.propertySignature(AggregateColumnSchema).pipe(Schema.fromKey("active_days")),
    firstActiveDay: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
      Schema.fromKey("first_active_day"),
    ),
    lastActiveDay: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
      Schema.fromKey("last_active_day"),
    ),
    calls: NullableAggregateColumnSchema,
  }),
  execute: (userId) =>
    statement(
      (sql) => sql`
        select
          count(*) as active_days,
          min(day) as first_active_day,
          max(day) as last_active_day,
          sum(calls) as calls
        from hosted_usage
        where user_id = ${userId}
      `,
    ),
});

const findQuotaLimitedDays = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, windowStartDay: Schema.String }),
  Result: CountRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select count(*) as value
        from hosted_usage
        where user_id = ${request.userId}
          and day >= ${request.windowStartDay}
          and ${ceilingReached(sql)}
      `,
    ),
});

const DayAccountRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.String),
  calls: AggregateColumnSchema,
});

const DayScopeSchema = Schema.Struct({ day: Schema.String, scope: AdminMetricsScopeSchema });

const findDayAccounts = SqlSchema.findAll({
  Request: DayScopeSchema,
  Result: DayAccountRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select "user".id, "user".name, "user".email, "user".image, "user".role, hosted_usage.calls
        from hosted_usage
        inner join "user" on "user".id = hosted_usage.user_id
        where hosted_usage.day = ${request.day} and ${keptByScope(sql, request.scope)}
        order by hosted_usage.calls desc, "user".id asc
        limit ${ADMIN_DAY_ACCOUNTS_LIMIT}
      `,
    ),
});

const findDayTotals = SqlSchema.findOne({
  Request: DayScopeSchema,
  Result: Schema.Struct({
    accounts: AggregateColumnSchema,
    calls: NullableAggregateColumnSchema,
  }),
  execute: (request) =>
    statement(
      (sql) => sql`
        select count(*) as accounts, sum(hosted_usage.calls) as calls
        from hosted_usage
        inner join "user" on "user".id = hosted_usage.user_id
        where hosted_usage.day = ${request.day} and ${keptByScope(sql, request.scope)}
      `,
    ),
});

/**
 * The accounts a search keeps: a case-insensitive substring of the name or
 * the email, the two fields a roster row is found by. The term travels as a
 * bound parameter — never interpolated into the SQL — with its own
 * wildcards escaped, so it can only ever name characters to find.
 */
function keptBySearch(sql: SqlClient.SqlClient, search: string | null) {
  if (search === null) return sql`true`;
  const pattern = searchLikePattern(search);
  return sql`("user".name ilike ${pattern} or "user".email ilike ${pattern})`;
}

/** The scope and the search as one condition, which is the whole roster filter. */
function keptByRoster(sql: SqlClient.SqlClient, request: RosterFilter) {
  return sql`${keptByScope(sql, request.scope)} and ${keptBySearch(sql, request.search)}`;
}

const RosterFilterSchema = Schema.Struct({
  scope: AdminMetricsScopeSchema,
  search: Schema.NullOr(Schema.String),
});

type RosterFilter = typeof RosterFilterSchema.Type;

/** A search nobody asked for is the absent one, which no `ilike` stands for. */
function nullableSearch(search: string | undefined): string | null {
  return search === undefined ? null : search;
}

const findRosterTotal = SqlSchema.findOne({
  Request: RosterFilterSchema,
  Result: CountRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`select count(*) as value from "user" where ${keptByRoster(sql, request)}`,
    ),
});

const findSessionsSeen = SqlSchema.findAll({
  Request: RosterFilterSchema,
  Result: Schema.Struct({
    userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
    seenAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
      Schema.fromKey("seen_at"),
    ),
  }),
  execute: (request) =>
    statement(
      (sql) => sql`
        select session.user_id, max(session.updated_at) as seen_at
        from session
        inner join "user" on "user".id = session.user_id
        where ${keptByRoster(sql, request)}
        group by session.user_id
      `,
    ),
});

const findUsageSeen = SqlSchema.findAll({
  Request: RosterFilterSchema,
  Result: Schema.Struct({
    userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
    lastUsageDay: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
      Schema.fromKey("last_usage_day"),
    ),
  }),
  execute: (request) =>
    statement(
      (sql) => sql`
        select hosted_usage.user_id, max(hosted_usage.day) as last_usage_day
        from hosted_usage
        inner join "user" on "user".id = hosted_usage.user_id
        where ${keptByRoster(sql, request)}
        group by hosted_usage.user_id
      `,
    ),
});

const RosterRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.String),
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("created_at")),
  activeDays: Schema.propertySignature(AggregateColumnSchema).pipe(Schema.fromKey("active_days")),
  lastActiveDay: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("last_active_day"),
  ),
  calls: NullableAggregateColumnSchema,
  favorite: Schema.NullOr(Schema.Boolean),
});

const findRosterRows = SqlSchema.findAll({
  Request: Schema.Struct({
    scope: AdminMetricsScopeSchema,
    search: Schema.NullOr(Schema.String),
    windowStartDay: Schema.String,
    viewerId: Schema.String,
  }),
  Result: RosterRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select
          "user".id,
          "user".name,
          "user".email,
          "user".image,
          "user".role,
          "user".created_at,
          count(hosted_usage.day) as active_days,
          max(hosted_usage.day) as last_active_day,
          sum(hosted_usage.calls) as calls,
          -- At most one star row joins per account, so aggregating its
          -- presence leaves the usage aggregates' fan-out untouched.
          bool_or(admin_favorite.admin_id is not null) as favorite
        from "user"
        left join hosted_usage
          on hosted_usage.user_id = "user".id and hosted_usage.day >= ${request.windowStartDay}
        left join admin_favorite
          on admin_favorite.user_id = "user".id and admin_favorite.admin_id = ${request.viewerId}
        where ${keptByRoster(sql, request)}
        group by
          "user".id, "user".name, "user".email, "user".image, "user".role, "user".created_at
        order by max(hosted_usage.day) desc nulls last, "user".created_at desc
        limit ${ADMIN_USERS_LIMIT}
      `,
    ),
});

const FavoriteSchema = Schema.Struct({
  adminId: Schema.String,
  userId: Schema.String,
  favorite: Schema.Boolean,
});

const findFavoriteTarget = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (userId) => statement((sql) => sql`select id from "user" where id = ${userId} limit 1`),
});

const insertFavorite = SqlSchema.void({
  Request: FavoriteSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into admin_favorite (admin_id, user_id)
        values (${write.adminId}, ${write.userId})
        on conflict do nothing
      `,
    ),
});

const deleteFavorite = SqlSchema.void({
  Request: FavoriteSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        delete from admin_favorite
        where admin_id = ${write.adminId} and user_id = ${write.userId}
      `,
    ),
});

/**
 * Reads everything one account's page shows, or nothing when no user row
 * carries the id. No probe and no empty fallback here: the detail page has no
 * health card to report an outage on, so a database that does not answer is
 * left to throw and become the handler's 503, where the metrics read instead
 * degrades to a page that can say so.
 */
export function readAdminUserSource(input: {
  userId: string;
  now: number;
  windowDays: AdminMetricsWindow;
}): Effect.Effect<AdminUserSource | undefined, AdminQueryFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const windowStartDay = lastNDayKeys(input.now, input.windowDays)[0] ?? utcDayKey(input.now);
    // The daily rows read from the wider bound so the builder's trends hold
    // both runs; the throttle count below stays on the window's own.
    const fetchStartDay =
      lastNDayKeys(input.now, windowFetchDays(input.windowDays))[0] ?? utcDayKey(input.now);
    // The calendar keeps a trailing-year bound of its own, apart from the
    // window, so switching windows never redraws the year.
    const calendarStartDay = calendarDayKeys(input.now)[0] ?? utcDayKey(input.now);

    const [account, signInMethods, windowRows, calendarRows, allTime, quotaLimited] =
      yield* Effect.all(
        [
          findAccount(input.userId),
          findSignInMethods(input.userId),
          findUsageSince({ userId: input.userId, sinceDay: fetchStartDay }),
          findUsageSince({ userId: input.userId, sinceDay: calendarStartDay }),
          findAllTimeUsage(input.userId),
          findQuotaLimitedDays({ userId: input.userId, windowStartDay }),
        ],
        { concurrency: "unbounded" },
      );

    if (Option.isNone(account)) return undefined;
    const row = account.value;

    const byDay = new Map<string, number>();
    for (const usageRow of windowRows) byDay.set(usageRow.day, usageRow.calls);

    const calendarByDay = new Map<string, number>();
    for (const usageRow of calendarRows) calendarByDay.set(usageRow.day, usageRow.calls);

    return {
      account: {
        id: row.id,
        name: row.name,
        email: row.email,
        image: row.image,
        admin: isAdminRole(row.role),
        createdAt: row.createdAt.getTime(),
        signInMethods: signInMethods.map((linked) => linked.providerId),
      },
      usage: {
        byDay,
        calendarByDay,
        allTime: {
          activeDays: Option.match(allTime, {
            onNone: () => 0,
            onSome: (totals) => totals.activeDays,
          }),
          firstActiveDay: Option.match(allTime, {
            onNone: () => null,
            onSome: (totals) => totals.firstActiveDay,
          }),
          lastActiveDay: Option.match(allTime, {
            onNone: () => null,
            onSome: (totals) => totals.lastActiveDay,
          }),
          calls: Option.match(allTime, {
            onNone: () => 0,
            onSome: (totals) => toNumber(totals.calls),
          }),
        },
        quotaLimitedDaysWindow: countOf(quotaLimited),
      },
    };
  });
}

/**
 * Reads one UTC day's active accounts with the day's totals. The usage table
 * holds one row per account per day, so each bounded row is already the
 * account's whole day and needs no aggregation; the totals ride their own
 * aggregate read because the rows are cut at the bound. Busiest first, with
 * the account id breaking ties so equally busy accounts keep a stable order
 * across refreshes.
 * Like the account detail, this has no probe and no empty fallback: a
 * database that does not answer throws into the handler's 503.
 */
export function readAdminDaySource(input: {
  day: string;
  scope: AdminMetricsScope;
}): Effect.Effect<AdminDaySource, AdminQueryFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const [accountRows, totals] = yield* Effect.all(
      [findDayAccounts(input), findDayTotals(input)],
      { concurrency: "unbounded" },
    );

    return {
      accounts: accountRows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        image: row.image,
        admin: isAdminRole(row.role),
        calls: row.calls,
      })),
      totals: {
        accounts: Option.match(totals, { onNone: () => 0, onSome: (row) => row.accounts }),
        calls: Option.match(totals, { onNone: () => 0, onSome: (row) => toNumber(row.calls) }),
      },
    };
  });
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
 * how many accounts match. Last-seen instants ride two queries of their own,
 * folded by `lastSeenInstant`: the freshest session write, which cannot join
 * the main read because a second one-to-many join would fan the usage
 * aggregates out across each account's session rows, and the all-time last
 * usage day, which the main read's own usage join cannot say because that
 * join is cut at the window where last-seen must not be.
 */
export function readAdminUsersSource(input: {
  now: number;
  scope: AdminMetricsScope;
  search: string | undefined;
  viewerId: string;
  windowDays: AdminMetricsWindow;
}): Effect.Effect<AdminUserListSource, AdminQueryFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const windowStartDay = lastNDayKeys(input.now, input.windowDays)[0] ?? utcDayKey(input.now);
    const kept = { scope: input.scope, search: nullableSearch(input.search) };

    const [total, sessionSeenRows, usageSeenRows, rows] = yield* Effect.all(
      [
        findRosterTotal(kept),
        findSessionsSeen(kept),
        findUsageSeen(kept),
        findRosterRows({ ...kept, windowStartDay, viewerId: input.viewerId }),
      ],
      { concurrency: "unbounded" },
    );

    const sessionSeenByUser = new Map<string, Date>();
    for (const seen of sessionSeenRows) {
      if (seen.seenAt) sessionSeenByUser.set(seen.userId, seen.seenAt);
    }
    const lastUsageDayByUser = new Map<string, string>();
    for (const seen of usageSeenRows) {
      if (seen.lastUsageDay) lastUsageDayByUser.set(seen.userId, seen.lastUsageDay);
    }

    return {
      total: countOf(total),
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        image: row.image,
        admin: isAdminRole(row.role),
        createdAt: row.createdAt.getTime(),
        activeDays: row.activeDays,
        lastActiveDay: row.lastActiveDay,
        lastSeenAt: lastSeenInstant(
          sessionSeenByUser.get(row.id) ?? null,
          lastUsageDayByUser.get(row.id) ?? null,
        ),
        calls: toNumber(row.calls),
        favorite: row.favorite === true,
      })),
    };
  });
}

/**
 * Sets whether one admin favorites one account, answering whether the account
 * exists at all: a press on a roster the account has since left should read as
 * the account being gone, not the write landing nowhere. Both writes land
 * twice without complaint — the star's presence is the whole state.
 */
export function writeAdminFavorite(input: {
  adminId: string;
  userId: string;
  favorite: boolean;
}): Effect.Effect<boolean, AdminQueryFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const target = yield* findFavoriteTarget(input.userId);
    if (Option.isNone(target)) return false;
    yield* input.favorite ? insertFavorite(input) : deleteFavorite(input);
    return true;
  });
}
