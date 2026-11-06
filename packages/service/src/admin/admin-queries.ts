import {
  Database,
  type DatabaseServices,
  type QueryError,
  queryBuilder,
} from "@repo/database/core/query";
import { InstantColumnSchema, NumberFromBigIntColumn } from "@repo/database/models/columns";
import { utcDayKey } from "@repo/database/models/quota";
import { account, session, user } from "@repo/database/schemas/auth";
import { adminFavorite } from "@repo/database/schemas/favorite";
import { hostedUsage } from "@repo/database/schemas/usage";
import { MEANINGFUL_ACTION, type MeaningfulAction } from "@repo/features/admin-overview-vocabulary";
import {
  ADMIN_METRICS_SCOPE,
  type AdminMetricsScope,
  type AdminMetricsWindow,
} from "@repo/features/admin-wire";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  max,
  min,
  ne,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { standingSupportAccess } from "../auth/auth-policy.js";
import { isAdminRole, USER_ROLE } from "./admin-access.js";
import { meaningfulActions, utcDay } from "./admin-activity-queries.js";
import { ADMIN_DAY_ACCOUNTS_LIMIT, type AdminDayHostedSource } from "./admin-day.js";
import {
  ADMIN_RETENTION_WEEKS,
  type AdminMetricsSource,
  cohortRetention,
  countSignInMethods,
  dayStart,
  lastNDayKeys,
  lastNWeekStartKeys,
  utcWeekStartKey,
  windowFetchDays,
} from "./admin-metrics.js";
import { type AdminUserSource, calendarDayKeys } from "./admin-user.js";
import {
  ADMIN_USERS_LAST_ACTIVE_DAYS,
  ADMIN_USERS_LIMIT,
  type AdminUserListSource,
  searchLikePatterns,
} from "./admin-users.js";

export type AdminQueryFailure = QueryError | Schema.SchemaError;

export const AggregateColumnSchema = Schema.Union([
  Schema.Number,
  Schema.NumberFromString,
  NumberFromBigIntColumn,
]);
export const NullableAggregateColumnSchema = Schema.NullOr(AggregateColumnSchema);

const UserRoleSchema = Schema.NullOr(Schema.Literals(Object.values(USER_ROLE)));

export const ACCOUNT_FACE_FIELDS = {
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  role: UserRoleSchema,
};

export const ACCOUNT_FACE_COLUMNS = {
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
  role: user.role,
};

export const findAccountFaces = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: Schema.Struct(ACCOUNT_FACE_FIELDS),
  execute: (ids) =>
    Database.use((db) =>
      db
        .select(ACCOUNT_FACE_COLUMNS)
        .from(user)
        .where(inArray(user.id, [...ids])),
    ),
});

const CountRowSchema = Schema.Struct({ value: AggregateColumnSchema });

export const AdminMetricsScopeSchema = Schema.Literals([
  ADMIN_METRICS_SCOPE.NON_ADMINS,
  ADMIN_METRICS_SCOPE.ALL,
]);

export function keptByScope(scope: AdminMetricsScope) {
  return scope === ADMIN_METRICS_SCOPE.ALL
    ? undefined
    : or(ne(user.role, USER_ROLE.ADMIN), isNull(user.role));
}

const countOf = Option.match({ onNone: () => 0, onSome: (row: { value: number }) => row.value });

const findUserTotal = SqlSchema.findOneOption({
  Request: AdminMetricsScopeSchema,
  Result: Schema.Struct({ value: AggregateColumnSchema }),
  execute: (scope) =>
    Database.use((db) => db.select({ value: count() }).from(user).where(keptByScope(scope))),
});

const SignInLinkRowSchema = Schema.Struct({
  userId: Schema.String,
  providerId: Schema.String,
});

const findSignInLinks = SqlSchema.findAll({
  Request: AdminMetricsScopeSchema,
  Result: SignInLinkRowSchema,
  execute: (scope) =>
    Database.use((db) =>
      db
        .selectDistinct({ userId: account.userId, providerId: account.providerId })
        .from(account)
        .innerJoin(user, eq(user.id, account.userId))
        .where(keptByScope(scope)),
    ),
});

const DayCountRowSchema = Schema.Struct({ day: Schema.String, value: AggregateColumnSchema });

const SIGNUP_DAY = sql<string>`to_char(${user.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;

const findSignupsByDay = SqlSchema.findAll({
  Request: Schema.Struct({ fetchStart: Schema.Date, scope: AdminMetricsScopeSchema }),
  Result: DayCountRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ day: SIGNUP_DAY, value: count() })
        .from(user)
        .where(and(gte(user.createdAt, request.fetchStart), keptByScope(request.scope)))
        .groupBy(SIGNUP_DAY),
    ),
});

const readUserMetrics = /* @__PURE__ */ Effect.fn("web/readUserMetrics")(function* (
  fetchStart: Date,
  scope: AdminMetricsScope,
): Effect.fn.Return<AdminMetricsSource["users"], AdminQueryFailure, DatabaseServices> {
  const [total, signups] = yield* Effect.all(
    [findUserTotal(scope), findSignupsByDay({ fetchStart, scope })],
    { concurrency: "unbounded" },
  );

  const signupsByDay = new Map<string, number>();
  for (const row of signups) signupsByDay.set(row.day, row.value);

  return { total: countOf(total), signupsByDay };
});

export const SIGNUP_WEEK = sql<string>`to_char(date_trunc('week', ${user.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
const ACTIVITY_WEEK = sql<string>`to_char(date_trunc('week', ${hostedUsage.day}::date), 'YYYY-MM-DD')`;

const CohortSizeRowSchema = Schema.Struct({
  week: Schema.String,
  value: AggregateColumnSchema,
});

export const findCohortSizes = SqlSchema.findAll({
  Request: Schema.Struct({ oldestWeekStart: Schema.Date, scope: AdminMetricsScopeSchema }),
  Result: CohortSizeRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ week: SIGNUP_WEEK, value: count() })
        .from(user)
        .where(and(gte(user.createdAt, request.oldestWeekStart), keptByScope(request.scope)))
        .groupBy(SIGNUP_WEEK),
    ),
});

const CohortActivityRowSchema = Schema.Struct({
  signupWeek: Schema.String,
  activityWeek: Schema.String,
  value: AggregateColumnSchema,
});

const findCohortActivity = SqlSchema.findAll({
  Request: Schema.Struct({
    oldestWeekStart: Schema.Date,
    oldestWeekStartDay: Schema.String,
    scope: AdminMetricsScopeSchema,
  }),
  Result: CohortActivityRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          signupWeek: SIGNUP_WEEK,
          activityWeek: ACTIVITY_WEEK,
          value: countDistinct(hostedUsage.userId),
        })
        .from(hostedUsage)
        .innerJoin(user, eq(user.id, hostedUsage.userId))
        .where(
          and(
            gte(user.createdAt, request.oldestWeekStart),
            gte(hostedUsage.day, request.oldestWeekStartDay),
            keptByScope(request.scope),
          ),
        )
        .groupBy(SIGNUP_WEEK, ACTIVITY_WEEK),
    ),
});

const readRetentionMetrics = /* @__PURE__ */ Effect.fn("web/readRetentionMetrics")(function* (
  now: number,
  scope: AdminMetricsScope,
): Effect.fn.Return<AdminMetricsSource["retention"], AdminQueryFailure, DatabaseServices> {
  const weekKeys = lastNWeekStartKeys(now, ADMIN_RETENTION_WEEKS);
  const oldestWeekStartDay = weekKeys[0] ?? utcWeekStartKey(now);
  const oldestWeekStart = dayStart(oldestWeekStartDay);

  const [sizeRows, activeRows] = yield* Effect.all(
    [
      findCohortSizes({ oldestWeekStart, scope }),
      findCohortActivity({ oldestWeekStart, oldestWeekStartDay, scope }),
    ],
    { concurrency: "unbounded" },
  );

  return cohortRetention(sizeRows, activeRows);
});

export function readAdminMetricsSource(input: {
  now: number;
  scope: AdminMetricsScope;
  windowDays: AdminMetricsWindow;
}): Effect.Effect<AdminMetricsSource, AdminQueryFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const fetchStartDay =
      lastNDayKeys(input.now, windowFetchDays(input.windowDays))[0] ?? utcDayKey(input.now);
    const fetchStart = dayStart(fetchStartDay);

    const [users, retention] = yield* Effect.all(
      [readUserMetrics(fetchStart, input.scope), readRetentionMetrics(input.now, input.scope)],
      { concurrency: "unbounded" },
    );

    return { users, retention };
  });
}

const AccountRowSchema = Schema.Struct({
  ...ACCOUNT_FACE_FIELDS,
  createdAt: InstantColumnSchema,
  supportAccessUntil: Schema.NullOr(InstantColumnSchema),
});

const findAccount = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: AccountRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          ...ACCOUNT_FACE_COLUMNS,
          createdAt: user.createdAt,
          supportAccessUntil: user.supportAccessUntil,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
    ),
});

const findSignInMethods = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ providerId: Schema.String }),
  execute: (userId) =>
    Database.use((db) =>
      db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, userId)),
    ),
});

const findUsageSince = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, sinceDay: Schema.String }),
  Result: Schema.Struct({ day: Schema.String, calls: AggregateColumnSchema }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ day: hostedUsage.day, calls: hostedUsage.calls })
        .from(hostedUsage)
        .where(and(eq(hostedUsage.userId, request.userId), gte(hostedUsage.day, request.sinceDay))),
    ),
});

const findAllTimeUsage = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({
    activeDays: AggregateColumnSchema,
    firstActiveDay: Schema.NullOr(Schema.String),
    lastActiveDay: Schema.NullOr(Schema.String),
    calls: NullableAggregateColumnSchema,
  }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          activeDays: count(),
          firstActiveDay: min(hostedUsage.day),
          lastActiveDay: max(hostedUsage.day),
          calls: sum(hostedUsage.calls),
        })
        .from(hostedUsage)
        .where(eq(hostedUsage.userId, userId)),
    ),
});

const findActionsByDay = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, since: Schema.Date }),
  Result: Schema.Struct({
    day: Schema.String,
    kind: Schema.Literals(Object.values(MEANINGFUL_ACTION)),
    value: AggregateColumnSchema,
  }),
  execute: (request) => {
    const actions = meaningfulActions(request.since);
    const day = utcDay(actions.at);
    return Database.use((db) =>
      db
        .select({ day, kind: actions.kind, value: count() })
        .from(actions)
        .where(eq(actions.userId, request.userId))
        .groupBy(day, actions.kind),
    );
  },
});

const DayAccountRowSchema = Schema.Struct({
  ...ACCOUNT_FACE_FIELDS,
  calls: AggregateColumnSchema,
});

const DayScopeSchema = Schema.Struct({ day: Schema.String, scope: AdminMetricsScopeSchema });

const findDayAccounts = SqlSchema.findAll({
  Request: DayScopeSchema,
  Result: DayAccountRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          ...ACCOUNT_FACE_COLUMNS,
          calls: hostedUsage.calls,
        })
        .from(hostedUsage)
        .innerJoin(user, eq(user.id, hostedUsage.userId))
        .where(and(eq(hostedUsage.day, request.day), keptByScope(request.scope)))
        .orderBy(desc(hostedUsage.calls), asc(user.id))
        .limit(ADMIN_DAY_ACCOUNTS_LIMIT),
    ),
});

const findDayTotals = SqlSchema.findOneOption({
  Request: DayScopeSchema,
  Result: Schema.Struct({
    accounts: AggregateColumnSchema,
    calls: NullableAggregateColumnSchema,
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ accounts: count(), calls: sum(hostedUsage.calls) })
        .from(hostedUsage)
        .innerJoin(user, eq(user.id, hostedUsage.userId))
        .where(and(eq(hostedUsage.day, request.day), keptByScope(request.scope))),
    ),
});

function keptBySearch(search: string | null) {
  if (search === null) return undefined;
  return and(
    ...searchLikePatterns(search).map((pattern) =>
      or(ilike(user.name, pattern), ilike(user.email, pattern)),
    ),
  );
}

function keptByRoster(request: RosterFilter) {
  return and(keptByScope(request.scope), keptBySearch(request.search));
}

const RosterFilterSchema = Schema.Struct({
  scope: AdminMetricsScopeSchema,
  search: Schema.NullOr(Schema.String),
});

type RosterFilter = typeof RosterFilterSchema.Type;

function nullableSearch(search: string | undefined): string | null {
  return search === undefined ? null : search;
}

const findRosterTotal = SqlSchema.findOneOption({
  Request: RosterFilterSchema,
  Result: CountRowSchema,
  execute: (request) =>
    Database.use((db) => db.select({ value: count() }).from(user).where(keptByRoster(request))),
});

const findSessionsSeen = SqlSchema.findAll({
  Request: RosterFilterSchema,
  Result: Schema.Struct({
    userId: Schema.String,
    seenAt: Schema.NullOr(InstantColumnSchema),
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ userId: session.userId, seenAt: max(session.updatedAt) })
        .from(session)
        .innerJoin(user, eq(user.id, session.userId))
        .where(keptByRoster(request))
        .groupBy(session.userId),
    ),
});

const RosterRowSchema = Schema.Struct({
  ...ACCOUNT_FACE_FIELDS,
  createdAt: InstantColumnSchema,
  activeDays: NullableAggregateColumnSchema,
  lastActiveDay: Schema.NullOr(Schema.String),
  favorite: Schema.Boolean,
});

function rosterActivity(lookbackStart: Date, windowStart: Date) {
  const actions = meaningfulActions(lookbackStart);
  const inWindow = sql`${actions.at} >= ${windowStart.toISOString()}::timestamptz`;
  return queryBuilder
    .select({
      userId: actions.userId,
      activeDays: sql<number>`count(distinct ${utcDay(actions.at)}) filter (where ${inWindow})`.as(
        "active_days",
      ),
      lastActionAt: sql<Date>`max(${actions.at})`.as("last_action_at"),
    })
    .from(actions)
    .groupBy(actions.userId)
    .as("roster_activity");
}

const findRosterRows = SqlSchema.findAll({
  Request: Schema.Struct({
    scope: AdminMetricsScopeSchema,
    search: Schema.NullOr(Schema.String),
    lookbackStart: Schema.Date,
    windowStart: Schema.Date,
    viewerId: Schema.String,
  }),
  Result: RosterRowSchema,
  execute: (request) => {
    const activity = rosterActivity(request.lookbackStart, request.windowStart);
    const mostRecentlyActiveFirst = sql`${activity.lastActionAt} desc nulls last`;
    return Database.use((db) =>
      db
        .select({
          ...ACCOUNT_FACE_COLUMNS,
          createdAt: user.createdAt,
          activeDays: activity.activeDays,
          lastActiveDay: utcDay(activity.lastActionAt),
          favorite: isNotNull(adminFavorite.adminId),
        })
        .from(user)
        .leftJoin(activity, eq(activity.userId, user.id))
        .leftJoin(
          adminFavorite,
          and(eq(adminFavorite.userId, user.id), eq(adminFavorite.adminId, request.viewerId)),
        )
        .where(keptByRoster(request))
        .orderBy(mostRecentlyActiveFirst, desc(user.createdAt))
        .limit(ADMIN_USERS_LIMIT),
    );
  },
});

const FavoriteSchema = Schema.Struct({
  adminId: Schema.String,
  userId: Schema.String,
  favorite: Schema.Boolean,
});

const findFavoriteTarget = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (userId) =>
    Database.use((db) => db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1)),
});

const insertFavorite = SqlSchema.void({
  Request: FavoriteSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(adminFavorite)
        .values({ adminId: write.adminId, userId: write.userId })
        .onConflictDoNothing(),
    ),
});

const deleteFavorite = SqlSchema.void({
  Request: FavoriteSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .delete(adminFavorite)
        .where(
          and(eq(adminFavorite.adminId, write.adminId), eq(adminFavorite.userId, write.userId)),
        ),
    ),
});

export function readAdminUserSource(input: {
  userId: string;
  now: number;
  windowDays: AdminMetricsWindow;
}): Effect.Effect<AdminUserSource | undefined, AdminQueryFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const fetchStartDay =
      lastNDayKeys(input.now, windowFetchDays(input.windowDays))[0] ?? utcDayKey(input.now);
    const calendarStartDay = calendarDayKeys(input.now)[0] ?? utcDayKey(input.now);

    const [account, signInMethods, actionRows, windowRows, calendarRows, allTime] =
      yield* Effect.all(
        [
          findAccount(input.userId),
          findSignInMethods(input.userId),
          findActionsByDay({ userId: input.userId, since: dayStart(calendarStartDay) }),
          findUsageSince({ userId: input.userId, sinceDay: fetchStartDay }),
          findUsageSince({ userId: input.userId, sinceDay: calendarStartDay }),
          findAllTimeUsage(input.userId),
        ],
        { concurrency: "unbounded" },
      );

    if (Option.isNone(account)) return undefined;
    const row = account.value;

    const actionsByDay = new Map<string, Map<MeaningfulAction, number>>();
    for (const action of actionRows) {
      const kinds = actionsByDay.get(action.day) ?? new Map<MeaningfulAction, number>();
      kinds.set(action.kind, action.value);
      actionsByDay.set(action.day, kinds);
    }

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
        supportAccessUntil: standingSupportAccess(row.supportAccessUntil, input.now),
      },
      actionsByDay,
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
            onSome: (totals) => totals.calls ?? 0,
          }),
        },
      },
    };
  });
}

export function readAdminDayHostedSource(input: {
  day: string;
  scope: AdminMetricsScope;
}): Effect.Effect<AdminDayHostedSource, AdminQueryFailure, DatabaseServices> {
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
        calls: Option.match(totals, { onNone: () => 0, onSome: (row) => row.calls ?? 0 }),
      },
    };
  });
}

export function readAdminUsersSource(input: {
  now: number;
  scope: AdminMetricsScope;
  search: string | undefined;
  viewerId: string;
  windowDays: AdminMetricsWindow;
}): Effect.Effect<AdminUserListSource, AdminQueryFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const windowStart = dayStart(
      lastNDayKeys(input.now, input.windowDays)[0] ?? utcDayKey(input.now),
    );
    const lookbackStart = dayStart(
      lastNDayKeys(input.now, ADMIN_USERS_LAST_ACTIVE_DAYS)[0] ?? utcDayKey(input.now),
    );
    const kept = { scope: input.scope, search: nullableSearch(input.search) };

    const [total, sessionSeenRows, rows, accounts, links] = yield* Effect.all(
      [
        findRosterTotal(kept),
        findSessionsSeen(kept),
        findRosterRows({ ...kept, lookbackStart, windowStart, viewerId: input.viewerId }),
        findUserTotal(input.scope),
        findSignInLinks(input.scope),
      ],
      { concurrency: "unbounded" },
    );

    const sessionSeenByUser = new Map<string, number>();
    for (const seen of sessionSeenRows) {
      if (seen.seenAt) sessionSeenByUser.set(seen.userId, seen.seenAt.getTime());
    }

    return {
      total: countOf(total),
      signIn: { accounts: countOf(accounts), methods: countSignInMethods(links) },
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        image: row.image,
        admin: isAdminRole(row.role),
        createdAt: row.createdAt.getTime(),
        activeDays: row.activeDays ?? 0,
        lastActiveDay: row.lastActiveDay,
        lastSeenAt: sessionSeenByUser.get(row.id) ?? null,
        favorite: row.favorite,
      })),
    };
  });
}

export function writeAdminFavorite(input: {
  adminId: string;
  userId: string;
  favorite: boolean;
}): Effect.Effect<boolean, AdminQueryFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const target = yield* findFavoriteTarget(input.userId);
    if (Option.isNone(target)) return false;
    yield* input.favorite ? insertFavorite(input) : deleteFavorite(input);
    return true;
  });
}
