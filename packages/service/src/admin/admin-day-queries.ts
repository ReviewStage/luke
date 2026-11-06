import { Database, type DatabaseServices, queryBuilder } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import type { AdminDayActivity } from "@repo/features/admin-answer-wire";
import {
  ACTIVITY_FEATURE,
  DAY_ACCOUNT_COUNT,
  type DailyCount,
  type DayAccountCount,
} from "@repo/features/admin-overview-vocabulary";
import type { AdminMetricsScope } from "@repo/features/admin-wire";
import { and, asc, count, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { DAY_MS } from "../core.js";
import { isAdminRole } from "./admin-access.js";
import { meaningfulActions } from "./admin-activity-queries.js";
import { ADMIN_DAY_ACCOUNTS_LIMIT, type AdminDaySource } from "./admin-day.js";
import { dayStart } from "./admin-metrics.js";
import { dailyCountRows, findDailyCounts } from "./admin-overview-queries.js";
import {
  ACCOUNT_FACE_COLUMNS,
  ACCOUNT_FACE_FIELDS,
  AdminMetricsScopeSchema,
  type AdminQueryFailure,
  AggregateColumnSchema,
  keptByScope,
  readAdminDayHostedSource,
} from "./admin-queries.js";

const DAY_ACCOUNT_COUNTS = Object.values(DAY_ACCOUNT_COUNT);

const DayBoundSchema = Schema.Struct({
  since: Schema.Date,
  until: Schema.Date,
  scope: AdminMetricsScopeSchema,
});

const findDayActiveAccounts = SqlSchema.findAll({
  Request: DayBoundSchema,
  Result: Schema.Struct({
    ...ACCOUNT_FACE_FIELDS,
    [DAY_ACCOUNT_COUNT.TASKS_CREATED]: AggregateColumnSchema,
    [DAY_ACCOUNT_COUNT.DESCRIPTION_REVISIONS]: AggregateColumnSchema,
    [DAY_ACCOUNT_COUNT.AGENTS_STARTED]: AggregateColumnSchema,
    [DAY_ACCOUNT_COUNT.INBOX_ANSWERED]: AggregateColumnSchema,
    [DAY_ACCOUNT_COUNT.AUTOMATION_RUNS]: AggregateColumnSchema,
    activeAccounts: AggregateColumnSchema,
  }),
  execute: (request) => {
    const rows = dailyCountRows(request.since, request.until);
    const actions = meaningfulActions(request.since, request.until);
    const counted = (kind: DayAccountCount): SQL<number> =>
      sql<number>`count(*) filter (where ${rows.tag} = ${kind})`;
    return Database.use((db) =>
      db
        .select({
          ...ACCOUNT_FACE_COLUMNS,
          [DAY_ACCOUNT_COUNT.TASKS_CREATED]: counted(DAY_ACCOUNT_COUNT.TASKS_CREATED),
          [DAY_ACCOUNT_COUNT.DESCRIPTION_REVISIONS]: counted(
            DAY_ACCOUNT_COUNT.DESCRIPTION_REVISIONS,
          ),
          [DAY_ACCOUNT_COUNT.AGENTS_STARTED]: counted(DAY_ACCOUNT_COUNT.AGENTS_STARTED),
          [DAY_ACCOUNT_COUNT.INBOX_ANSWERED]: counted(DAY_ACCOUNT_COUNT.INBOX_ANSWERED),
          [DAY_ACCOUNT_COUNT.AUTOMATION_RUNS]: counted(DAY_ACCOUNT_COUNT.AUTOMATION_RUNS),
          activeAccounts: sql<number>`count(*) over ()`,
        })
        .from(rows)
        .innerJoin(user, eq(user.id, rows.userId))
        .where(
          and(
            inArray(rows.tag, DAY_ACCOUNT_COUNTS),
            inArray(rows.userId, queryBuilder.select({ userId: actions.userId }).from(actions)),
            keptByScope(request.scope),
          ),
        )
        .groupBy(user.id, user.name, user.email, user.image, user.role)
        .orderBy(desc(count()), asc(user.id))
        .limit(ADMIN_DAY_ACCOUNTS_LIMIT),
    );
  },
});

const readDayActivity = /* @__PURE__ */ Effect.fn("web/readAdminDayActivity")(function* (
  since: Date,
  scope: AdminMetricsScope,
): Effect.fn.Return<AdminDayActivity, AdminQueryFailure, DatabaseServices> {
  const request = { since, until: new Date(since.getTime() + DAY_MS), scope };
  const [dailyRows, accountRows] = yield* Effect.all(
    [findDailyCounts(request), findDayActiveAccounts(request)],
    { concurrency: "unbounded" },
  );

  const byTag = new Map<DailyCount, number>(dailyRows.map((row) => [row.tag, row.value]));
  const on = (count: DailyCount) => byTag.get(count) ?? 0;

  return {
    features: {
      [ACTIVITY_FEATURE.AGENTS_STARTED]: on(ACTIVITY_FEATURE.AGENTS_STARTED),
      [ACTIVITY_FEATURE.DESCRIPTION_REVISIONS]: on(ACTIVITY_FEATURE.DESCRIPTION_REVISIONS),
      [ACTIVITY_FEATURE.INBOX_ANSWERED]: on(ACTIVITY_FEATURE.INBOX_ANSWERED),
      [ACTIVITY_FEATURE.AUTOMATION_RUNS]: on(ACTIVITY_FEATURE.AUTOMATION_RUNS),
    },
    activeDevelopers: accountRows[0]?.activeAccounts ?? 0,
    accounts: accountRows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      admin: isAdminRole(row.role),
      counts: {
        [DAY_ACCOUNT_COUNT.TASKS_CREATED]: row[DAY_ACCOUNT_COUNT.TASKS_CREATED],
        [DAY_ACCOUNT_COUNT.DESCRIPTION_REVISIONS]: row[DAY_ACCOUNT_COUNT.DESCRIPTION_REVISIONS],
        [DAY_ACCOUNT_COUNT.AGENTS_STARTED]: row[DAY_ACCOUNT_COUNT.AGENTS_STARTED],
        [DAY_ACCOUNT_COUNT.INBOX_ANSWERED]: row[DAY_ACCOUNT_COUNT.INBOX_ANSWERED],
        [DAY_ACCOUNT_COUNT.AUTOMATION_RUNS]: row[DAY_ACCOUNT_COUNT.AUTOMATION_RUNS],
      },
    })),
  };
});

export function readAdminDaySource(input: {
  day: string;
  scope: AdminMetricsScope;
}): Effect.Effect<AdminDaySource, AdminQueryFailure, DatabaseServices> {
  return Effect.map(
    Effect.all(
      [readDayActivity(dayStart(input.day), input.scope), readAdminDayHostedSource(input)],
      {
        concurrency: "unbounded",
      },
    ),
    ([activity, hosted]) => ({ activity, hosted }),
  );
}
