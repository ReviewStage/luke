/**
 * admin-day-queries.ts -- one UTC day's live activity: each feature's count,
 * and the accounts active that day with what each did.
 *
 * Both reads go through the Overview's own definitions bounded to the day,
 * `dailyCountRows` for what was done and `meaningfulActions` for who was
 * active, so each tile equals the segment of the bar that opened the page.
 * Neither timestamp a union arm is bounded by leads an index, so each arm
 * scans its table as the Overview's chart read does; the day bound only
 * narrows what is grouped. The retired hosted tier's day, read in
 * `admin-queries.ts`, rides beside them.
 */

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

/**
 * Each day's account with its count of every kind, busiest first by all of
 * them together, the account id breaking ties so equally busy accounts keep
 * one order across refreshes. An account is listed only when it took a
 * meaningful action that day, and every such action is itself one of the
 * rows counted here (a task, the developer's own plan revision, an agent),
 * so the window count over the groups, taken before the bound cuts them, is
 * the day's active developers.
 */
const findDayActiveAccounts = SqlSchema.findAll({
  Request: DayBoundSchema,
  Result: Schema.Struct({
    ...ACCOUNT_FACE_FIELDS,
    [DAY_ACCOUNT_COUNT.TASKS_CREATED]: AggregateColumnSchema,
    [DAY_ACCOUNT_COUNT.PLAN_REVISIONS]: AggregateColumnSchema,
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
          [DAY_ACCOUNT_COUNT.PLAN_REVISIONS]: counted(DAY_ACCOUNT_COUNT.PLAN_REVISIONS),
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

/**
 * The day's live activity: the chart's daily counts for the day, which hold
 * one row per count since the day is the bound, and its active accounts.
 */
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
      [ACTIVITY_FEATURE.PLAN_REVISIONS]: on(ACTIVITY_FEATURE.PLAN_REVISIONS),
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
        [DAY_ACCOUNT_COUNT.PLAN_REVISIONS]: row[DAY_ACCOUNT_COUNT.PLAN_REVISIONS],
        [DAY_ACCOUNT_COUNT.AGENTS_STARTED]: row[DAY_ACCOUNT_COUNT.AGENTS_STARTED],
        [DAY_ACCOUNT_COUNT.INBOX_ANSWERED]: row[DAY_ACCOUNT_COUNT.INBOX_ANSWERED],
        [DAY_ACCOUNT_COUNT.AUTOMATION_RUNS]: row[DAY_ACCOUNT_COUNT.AUTOMATION_RUNS],
      },
    })),
  };
});

/**
 * Reads one UTC day: its live activity and the hosted tier's beside it, at
 * once. Like the account detail, this has no probe and no empty fallback: a
 * database that does not answer throws into the handler's 503.
 */
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
