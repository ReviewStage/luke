/**
 * admin-overview-queries.ts -- the Overview's reads of tasks, plan revisions,
 * coding agents, pull requests, calls, the inbox, automations, and chat.
 *
 * Every read counts rows or reads a timestamp, a status, or an id; none names
 * a column that holds what an account typed, said, or ran. Every read joins
 * the account each row is attributed to and keeps it through `keptByScope`,
 * so the hide-admins toggle filters every number here as it does the rest of
 * the dashboard. `buildAdminOverview` in `admin-overview.ts` shapes what this
 * reads.
 */

import { Database, type DatabaseServices, queryBuilder } from "@luke/database/core/query";
import { GITHUB_INSTALLATION_STATUS } from "@luke/database/github-installation-vocabulary";
import { InstantColumnSchema } from "@luke/database/models/columns";
import { member, session, user } from "@luke/database/schemas/auth";
import { automationRun } from "@luke/database/schemas/automation";
import { chatMember, chatMessage } from "@luke/database/schemas/chat";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { inboxItem } from "@luke/database/schemas/inbox";
import { integrationConnection } from "@luke/database/schemas/integration";
import { planRevision } from "@luke/database/schemas/plan-revision";
import { task } from "@luke/database/schemas/task";
import { voiceSessions } from "@luke/database/schemas/voice";
import { workspaceIntegrationConnection } from "@luke/database/schemas/workspace-integration";
import { AUTOMATION_RUN_STATUS } from "@luke/features/automation-wire";
import { MEMBER_KIND } from "@luke/features/chat-wire";
import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { INBOX_STATUS } from "@luke/features/inbox-wire";
import { INTEGRATION_STATUS } from "@luke/features/integration-wire";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import {
  type AnyColumn,
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  max,
  ne,
  or,
  type SQL,
  sql,
  sum,
} from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { isAdminRole } from "./admin-access.js";
import {
  ADMIN_RETENTION_WEEKS,
  ADMIN_TREND_DAYS,
  type AdminMetricsSource,
  lastNDayKeys,
  lastNWeekStartKeys,
  utcWeekStartKey,
  windowFetchDays,
} from "./admin-metrics.js";
import { ADMIN_OVERVIEW_ACCOUNTS_LIMIT, type AdminOverviewSource } from "./admin-overview.js";
import {
  DAILY_COUNT,
  type DailyCount,
  FUNNEL_STEP,
  type FunnelStep,
  REACH_FEATURE,
  type ReachFeature,
} from "./admin-overview-vocabulary.js";
import {
  AdminMetricsScopeSchema,
  type AdminQueryFailure,
  AggregateColumnSchema,
  findCohortSizes,
  keptByScope,
  NullableAggregateColumnSchema,
  readAdminMetricsSource,
  SIGNUP_WEEK,
  UserRoleSchema,
} from "./admin-queries.js";
import type { AdminMetricsScope, AdminMetricsWindow } from "./http.js";

const DailyCountSchema = Schema.Literals(Object.values(DAILY_COUNT));
const ReachFeatureSchema = Schema.Literals(Object.values(REACH_FEATURE));

/** The UTC day an instant falls on, as the YYYY-MM-DD key the builder zero-fills by. */
function utcDay(instant: SQL | SQL.Aliased): SQL<string> {
  return sql<string>`to_char(${instant} at time zone 'UTC', 'YYYY-MM-DD')`;
}

/** An instant a union's column is compared to, cast because the union's columns carry no codec. */
function instant(at: Date): SQL {
  return sql`${at.toISOString()}::timestamptz`;
}

/** A fixed name riding a union's rows, cast so Postgres knows the parameter's type. */
function tag(name: string): SQL.Aliased<string> {
  return sql<string>`${name}::text`.as("tag");
}

/** The account a union's row is attributed to, under the one name every member selects it as. */
function userIdOf(column: AnyColumn | SQL): SQL.Aliased<string> {
  return sql<string>`${column}`.as("user_id");
}

/** The instant a union's row is dated by, under the one name every member selects it as. */
function atOf(column: AnyColumn | SQL): SQL.Aliased<Date> {
  return sql<Date>`${column}`.as("at");
}

/** When an agent's pull request merged, as an instant; null where it has not. */
const MERGED_AT = sql`to_timestamp((${codingAgent.published} ->> 'mergedAt')::numeric / 1000)`;

/** Whether an agent's pull request is merged, by its stamp or its state. */
const PR_MERGED = or(
  isNotNull(sql`${codingAgent.published} ->> 'mergedAt'`),
  eq(sql`${codingAgent.published} ->> 'state'`, PULL_REQUEST_STATE.MERGED),
);

/** Whether an automation started the agent: its link, or the origin that outlives the automation. */
const STARTED_BY_AUTOMATION = or(
  isNotNull(codingAgent.automationId),
  isNotNull(codingAgent.automationOrigin),
);

/**
 * Every meaningful action since `since`, one row per action: the account that
 * took it and when. This is the one definition of "active" on the Overview:
 * the active-developer tiles, feature reach's base, the most active accounts,
 * and the meaningful retention grid all count through it. A plan revision
 * counts only as the developer's own, under their user id; Luke's notes on a
 * call are the call, and an agent's revisions are the agent.
 */
function meaningfulActions(since: Date) {
  return unionAll(
    queryBuilder
      .select({ userId: userIdOf(task.userId), at: atOf(task.createdAt) })
      .from(task)
      .where(gte(task.createdAt, since)),
    queryBuilder
      .select({ userId: userIdOf(planRevision.userId), at: atOf(planRevision.at) })
      .from(planRevision)
      .where(
        and(
          eq(planRevision.actor, PLAN_ACTOR.DEVELOPER),
          isNotNull(planRevision.userId),
          gte(planRevision.at, since),
        ),
      ),
    queryBuilder
      .select({ userId: userIdOf(codingAgent.userId), at: atOf(codingAgent.createdAt) })
      .from(codingAgent)
      .where(gte(codingAgent.createdAt, since)),
    queryBuilder
      .select({ userId: userIdOf(voiceSessions.userId), at: atOf(voiceSessions.startedAt) })
      .from(voiceSessions)
      .where(gte(voiceSessions.startedAt, since)),
  ).as("meaningful_action");
}

/**
 * Every row a daily count counts since `since`, tagged with the count it
 * belongs to: the account it is attributed to and the instant it is dated by.
 * An inbox answer is the answering member's, and an automation run its
 * owner's; a run a guard held back started nothing and is no run.
 */
function dailyCountRows(since: Date) {
  return unionAll(
    queryBuilder
      .select({
        tag: tag(DAILY_COUNT.TASKS_CREATED),
        userId: userIdOf(task.userId),
        at: atOf(task.createdAt),
      })
      .from(task)
      .where(gte(task.createdAt, since)),
    queryBuilder
      .select({
        tag: tag(DAILY_COUNT.AGENTS_STARTED),
        userId: userIdOf(codingAgent.userId),
        at: atOf(codingAgent.createdAt),
      })
      .from(codingAgent)
      .where(gte(codingAgent.createdAt, since)),
    queryBuilder
      .select({
        tag: tag(DAILY_COUNT.AGENTS_FROM_AUTOMATIONS),
        userId: userIdOf(codingAgent.userId),
        at: atOf(codingAgent.createdAt),
      })
      .from(codingAgent)
      .where(and(gte(codingAgent.createdAt, since), STARTED_BY_AUTOMATION)),
    queryBuilder
      .select({
        tag: tag(DAILY_COUNT.PRS_MERGED),
        userId: userIdOf(codingAgent.userId),
        at: atOf(MERGED_AT),
      })
      .from(codingAgent)
      .where(gte(sql`(${codingAgent.published} ->> 'mergedAt')::numeric`, since.getTime())),
    queryBuilder
      .select({
        tag: tag(DAILY_COUNT.PLAN_REVISIONS),
        userId: userIdOf(planRevision.userId),
        at: atOf(planRevision.at),
      })
      .from(planRevision)
      .where(
        and(
          inArray(planRevision.actor, [PLAN_ACTOR.DEVELOPER, PLAN_ACTOR.NOTETAKER]),
          isNotNull(planRevision.userId),
          gte(planRevision.at, since),
        ),
      ),
    queryBuilder
      .select({
        tag: tag(DAILY_COUNT.CALLS_HELD),
        userId: userIdOf(voiceSessions.userId),
        at: atOf(voiceSessions.startedAt),
      })
      .from(voiceSessions)
      .where(gte(voiceSessions.startedAt, since)),
    queryBuilder
      .select({
        tag: tag(DAILY_COUNT.INBOX_ANSWERED),
        userId: userIdOf(inboxItem.answeredBy),
        at: atOf(inboxItem.settledAt),
      })
      .from(inboxItem)
      .where(
        and(
          eq(inboxItem.status, INBOX_STATUS.ANSWERED),
          isNotNull(inboxItem.answeredBy),
          gte(inboxItem.settledAt, since),
        ),
      ),
    queryBuilder
      .select({
        tag: tag(DAILY_COUNT.AUTOMATION_RUNS),
        userId: userIdOf(automationRun.userId),
        at: atOf(automationRun.firedAt),
      })
      .from(automationRun)
      .where(
        and(
          ne(automationRun.status, AUTOMATION_RUN_STATUS.SKIPPED),
          gte(automationRun.firedAt, since),
        ),
      ),
  ).as("daily_count_row");
}

/**
 * Every account that used a reachable feature since `since`, tagged with the
 * feature. Integrations are a state rather than a use, so they carry no
 * bound: an account counts with a connection of its own, or one connected on
 * a workspace it belongs to, standing now.
 */
function reachRows(since: Date) {
  return unionAll(
    queryBuilder
      .select({ tag: tag(REACH_FEATURE.TASKS), userId: userIdOf(task.userId) })
      .from(task)
      .where(gte(task.createdAt, since)),
    queryBuilder
      .select({ tag: tag(REACH_FEATURE.TASKS), userId: userIdOf(planRevision.userId) })
      .from(planRevision)
      .where(
        and(
          eq(planRevision.actor, PLAN_ACTOR.DEVELOPER),
          isNotNull(planRevision.userId),
          gte(planRevision.at, since),
        ),
      ),
    queryBuilder
      .select({ tag: tag(REACH_FEATURE.CODING_AGENTS), userId: userIdOf(codingAgent.userId) })
      .from(codingAgent)
      .where(gte(codingAgent.createdAt, since)),
    queryBuilder
      .select({ tag: tag(REACH_FEATURE.INBOX), userId: userIdOf(inboxItem.answeredBy) })
      .from(inboxItem)
      .where(
        and(
          eq(inboxItem.status, INBOX_STATUS.ANSWERED),
          isNotNull(inboxItem.answeredBy),
          gte(inboxItem.settledAt, since),
        ),
      ),
    queryBuilder
      .select({ tag: tag(REACH_FEATURE.VOICE_CALLS), userId: userIdOf(voiceSessions.userId) })
      .from(voiceSessions)
      .where(gte(voiceSessions.startedAt, since)),
    queryBuilder
      .select({
        tag: tag(REACH_FEATURE.INTEGRATIONS),
        userId: userIdOf(integrationConnection.userId),
      })
      .from(integrationConnection)
      .where(eq(integrationConnection.status, INTEGRATION_STATUS.CONNECTED)),
    queryBuilder
      .select({ tag: tag(REACH_FEATURE.INTEGRATIONS), userId: userIdOf(member.userId) })
      .from(workspaceIntegrationConnection)
      .innerJoin(member, eq(member.organizationId, workspaceIntegrationConnection.organizationId))
      .where(eq(workspaceIntegrationConnection.status, INTEGRATION_STATUS.CONNECTED)),
    queryBuilder
      .select({ tag: tag(REACH_FEATURE.AUTOMATIONS), userId: userIdOf(automationRun.userId) })
      .from(automationRun)
      .where(
        and(
          ne(automationRun.status, AUTOMATION_RUN_STATUS.SKIPPED),
          gte(automationRun.firedAt, since),
        ),
      ),
    queryBuilder
      .select({ tag: tag(REACH_FEATURE.CHAT), userId: userIdOf(chatMember.userId) })
      .from(chatMessage)
      .innerJoin(chatMember, eq(chatMember.id, chatMessage.authorMemberId))
      .where(
        and(
          eq(chatMember.kind, MEMBER_KIND.HUMAN),
          isNotNull(chatMember.userId),
          gte(chatMessage.createdAt, since),
        ),
      ),
  ).as("reach_row");
}

const BoundScopeSchema = Schema.Struct({ since: Schema.Date, scope: AdminMetricsScopeSchema });

const findActiveDevelopers = SqlSchema.findOneOption({
  Request: Schema.Struct({
    priorStart: Schema.Date,
    recentStart: Schema.Date,
    scope: AdminMetricsScopeSchema,
  }),
  Result: Schema.Struct({ recent: AggregateColumnSchema, prior: AggregateColumnSchema }),
  execute: (request) => {
    const actions = meaningfulActions(request.priorStart);
    const recent = sql`${actions.at} >= ${instant(request.recentStart)}`;
    return Database.use((db) =>
      db
        .select({
          recent: sql<number>`count(distinct ${actions.userId}) filter (where ${recent})`,
          prior: sql<number>`count(distinct ${actions.userId}) filter (where not (${recent}))`,
        })
        .from(actions)
        .innerJoin(user, eq(user.id, actions.userId))
        .where(keptByScope(request.scope)),
    );
  },
});

const findDailyCounts = SqlSchema.findAll({
  Request: BoundScopeSchema,
  Result: Schema.Struct({
    tag: DailyCountSchema,
    day: Schema.String,
    value: AggregateColumnSchema,
  }),
  execute: (request) => {
    const rows = dailyCountRows(request.since);
    const day = utcDay(rows.at);
    return Database.use((db) =>
      db
        .select({ tag: rows.tag, day, value: count() })
        .from(rows)
        .innerJoin(user, eq(user.id, rows.userId))
        .where(keptByScope(request.scope))
        .groupBy(rows.tag, day),
    );
  },
});

/** The pull requests opened by agents started since the bound, and how many of those merged. */
const findPrsOpened = SqlSchema.findOneOption({
  Request: BoundScopeSchema,
  Result: Schema.Struct({ opened: AggregateColumnSchema, merged: AggregateColumnSchema }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          opened: count(),
          merged: sql<number>`count(*) filter (where ${PR_MERGED})`,
        })
        .from(codingAgent)
        .innerJoin(user, eq(user.id, codingAgent.userId))
        .where(
          and(
            gte(codingAgent.createdAt, request.since),
            isNotNull(codingAgent.published),
            keptByScope(request.scope),
          ),
        ),
    ),
});

/** Whether the account in the outer row ever did something, as a correlated `exists`. */
function everDid(subquery: Parameters<typeof exists>[0]): SQL<number> {
  return sql<number>`count(*) filter (where ${exists(subquery)})`;
}

const one = sql`1`;

/**
 * Each funnel step over the accounts created since the bound: how many of
 * them ever took it, at any time since signing up. GitHub counts as connected
 * where a workspace the account belongs to holds an active installation.
 */
const findFunnel = SqlSchema.findOneOption({
  Request: BoundScopeSchema,
  Result: Schema.Struct({
    [FUNNEL_STEP.SIGNED_UP]: AggregateColumnSchema,
    [FUNNEL_STEP.GITHUB_CONNECTED]: AggregateColumnSchema,
    [FUNNEL_STEP.CREATED_TASK]: AggregateColumnSchema,
    [FUNNEL_STEP.HELD_CALL]: AggregateColumnSchema,
    [FUNNEL_STEP.STARTED_AGENT]: AggregateColumnSchema,
    [FUNNEL_STEP.OPENED_PR]: AggregateColumnSchema,
    [FUNNEL_STEP.MERGED_PR]: AggregateColumnSchema,
  }),
  execute: (request) => {
    const agentOf = eq(codingAgent.userId, user.id);
    return Database.use((db) =>
      db
        .select({
          [FUNNEL_STEP.SIGNED_UP]: count(),
          [FUNNEL_STEP.GITHUB_CONNECTED]: everDid(
            queryBuilder
              .select({ one })
              .from(member)
              .innerJoin(
                githubInstallation,
                eq(githubInstallation.organizationId, member.organizationId),
              )
              .where(
                and(
                  eq(member.userId, user.id),
                  eq(githubInstallation.status, GITHUB_INSTALLATION_STATUS.ACTIVE),
                ),
              ),
          ),
          [FUNNEL_STEP.CREATED_TASK]: everDid(
            queryBuilder.select({ one }).from(task).where(eq(task.userId, user.id)),
          ),
          [FUNNEL_STEP.HELD_CALL]: everDid(
            queryBuilder
              .select({ one })
              .from(voiceSessions)
              .where(eq(voiceSessions.userId, user.id)),
          ),
          [FUNNEL_STEP.STARTED_AGENT]: everDid(
            queryBuilder.select({ one }).from(codingAgent).where(agentOf),
          ),
          [FUNNEL_STEP.OPENED_PR]: everDid(
            queryBuilder
              .select({ one })
              .from(codingAgent)
              .where(and(agentOf, isNotNull(codingAgent.published))),
          ),
          [FUNNEL_STEP.MERGED_PR]: everDid(
            queryBuilder
              .select({ one })
              .from(codingAgent)
              .where(and(agentOf, isNotNull(codingAgent.published), PR_MERGED)),
          ),
        })
        .from(user)
        .where(and(gte(user.createdAt, request.since), keptByScope(request.scope))),
    );
  },
});

/** Each feature's distinct users since the bound, among the accounts active since it. */
const findReach = SqlSchema.findAll({
  Request: BoundScopeSchema,
  Result: Schema.Struct({ tag: ReachFeatureSchema, value: AggregateColumnSchema }),
  execute: (request) => {
    const rows = reachRows(request.since);
    const actions = meaningfulActions(request.since);
    return Database.use((db) =>
      db
        .select({ tag: rows.tag, value: countDistinct(rows.userId) })
        .from(rows)
        .innerJoin(user, eq(user.id, rows.userId))
        .where(
          and(
            inArray(rows.userId, queryBuilder.select({ userId: actions.userId }).from(actions)),
            keptByScope(request.scope),
          ),
        )
        .groupBy(rows.tag),
    );
  },
});

/**
 * The accounts with the most days holding a meaningful action since the
 * bound. Days present come before volume: thirty quiet days outrank one heavy
 * one, and the action count only breaks ties, the account id after it, so
 * equally active accounts keep one order across refreshes.
 */
const findTopAccounts = SqlSchema.findAll({
  Request: BoundScopeSchema,
  Result: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: Schema.NullOr(Schema.String),
    role: UserRoleSchema,
    activeDays: AggregateColumnSchema,
  }),
  execute: (request) => {
    const actions = meaningfulActions(request.since);
    const activeDays = sql<number>`count(distinct ${utcDay(actions.at)})`;
    return Database.use((db) =>
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          activeDays,
        })
        .from(actions)
        .innerJoin(user, eq(user.id, actions.userId))
        .where(keptByScope(request.scope))
        .groupBy(user.id, user.name, user.email, user.image, user.role)
        .orderBy(desc(activeDays), desc(count()), asc(user.id))
        .limit(ADMIN_OVERVIEW_ACCOUNTS_LIMIT),
    );
  },
});

const AccountsSinceSchema = Schema.Struct({
  userIds: Schema.Array(Schema.String),
  since: Schema.Date,
});

const UserCountRowSchema = Schema.Struct({
  userId: Schema.String,
  value: NullableAggregateColumnSchema,
});

const findTasksBy = SqlSchema.findAll({
  Request: AccountsSinceSchema,
  Result: UserCountRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ userId: task.userId, value: count() })
        .from(task)
        .where(and(inArray(task.userId, request.userIds), gte(task.createdAt, request.since)))
        .groupBy(task.userId),
    ),
});

const findAgentsBy = SqlSchema.findAll({
  Request: AccountsSinceSchema,
  Result: UserCountRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ userId: codingAgent.userId, value: count() })
        .from(codingAgent)
        .where(
          and(
            inArray(codingAgent.userId, request.userIds),
            gte(codingAgent.createdAt, request.since),
          ),
        )
        .groupBy(codingAgent.userId),
    ),
});

const findPrsMergedBy = SqlSchema.findAll({
  Request: AccountsSinceSchema,
  Result: UserCountRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ userId: codingAgent.userId, value: count() })
        .from(codingAgent)
        .where(
          and(
            inArray(codingAgent.userId, request.userIds),
            gte(sql`(${codingAgent.published} ->> 'mergedAt')::numeric`, request.since.getTime()),
          ),
        )
        .groupBy(codingAgent.userId),
    ),
});

/**
 * The seconds of the account's calls started since the bound: the metered
 * seconds where the call recorded them, its open span where it closed without,
 * and nothing for a call still open with neither.
 */
const findCallSecondsBy = SqlSchema.findAll({
  Request: AccountsSinceSchema,
  Result: UserCountRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          userId: voiceSessions.userId,
          value: sum(
            sql`coalesce((${voiceSessions.usage} ->> 'seconds')::numeric, extract(epoch from (${voiceSessions.closedAt} - ${voiceSessions.startedAt})), 0)`,
          ),
        })
        .from(voiceSessions)
        .where(
          and(
            inArray(voiceSessions.userId, request.userIds),
            gte(voiceSessions.startedAt, request.since),
          ),
        )
        .groupBy(voiceSessions.userId),
    ),
});

const findLastSeenBy = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: Schema.Struct({ userId: Schema.String, seenAt: Schema.NullOr(InstantColumnSchema) }),
  execute: (userIds) =>
    Database.use((db) =>
      db
        .select({ userId: session.userId, seenAt: max(session.updatedAt) })
        .from(session)
        .where(inArray(session.userId, userIds))
        .groupBy(session.userId),
    ),
});

function countsByUser(
  rows: readonly { userId: string; value: number | null }[],
): Map<string, number> {
  return new Map(rows.map((row) => [row.userId, row.value ?? 0]));
}

/** The ranked accounts' own counts over the window; no account, no read. */
const readAccountCounts = /* @__PURE__ */ Effect.fn("web/readOverviewAccountCounts")(function* (
  userIds: readonly string[],
  since: Date,
): Effect.fn.Return<AdminOverviewSource["accountCounts"], AdminQueryFailure, DatabaseServices> {
  if (userIds.length === 0) {
    const none = new Map<string, number>();
    return { tasks: none, agents: none, prsMerged: none, callSeconds: none, lastSeenAt: none };
  }
  const request = { userIds, since };
  const [tasks, agents, prsMerged, callSeconds, seen] = yield* Effect.all(
    [
      findTasksBy(request),
      findAgentsBy(request),
      findPrsMergedBy(request),
      findCallSecondsBy(request),
      findLastSeenBy(userIds),
    ],
    { concurrency: "unbounded" },
  );
  const lastSeenAt = new Map<string, number>();
  for (const row of seen) if (row.seenAt) lastSeenAt.set(row.userId, row.seenAt.getTime());
  return {
    tasks: countsByUser(tasks),
    agents: countsByUser(agents),
    prsMerged: countsByUser(prsMerged),
    callSeconds: countsByUser(callSeconds),
    lastSeenAt,
  };
});

/**
 * Distinct cohort accounts with a meaningful action per (signup week, action
 * week) pair, on the same Monday-started UTC weeks the hosted grid's query
 * names, so the two bases draw the same rows and columns.
 */
const findMeaningfulCohortActivity = SqlSchema.findAll({
  Request: Schema.Struct({ oldestWeekStart: Schema.Date, scope: AdminMetricsScopeSchema }),
  Result: Schema.Struct({
    signupWeek: Schema.String,
    activityWeek: Schema.String,
    value: AggregateColumnSchema,
  }),
  execute: (request) => {
    const actions = meaningfulActions(request.oldestWeekStart);
    const activityWeek = sql<string>`to_char(date_trunc('week', ${actions.at} at time zone 'UTC'), 'YYYY-MM-DD')`;
    return Database.use((db) =>
      db
        .select({
          signupWeek: SIGNUP_WEEK,
          activityWeek,
          value: countDistinct(actions.userId),
        })
        .from(actions)
        .innerJoin(user, eq(user.id, actions.userId))
        .where(and(gte(user.createdAt, request.oldestWeekStart), keptByScope(request.scope)))
        .groupBy(SIGNUP_WEEK, activityWeek),
    );
  },
});

const readMeaningfulRetention = /* @__PURE__ */ Effect.fn("web/readMeaningfulRetention")(function* (
  now: number,
  scope: AdminMetricsScope,
): Effect.fn.Return<AdminMetricsSource["retention"], AdminQueryFailure, DatabaseServices> {
  const oldestWeekStart = dayStart(
    lastNWeekStartKeys(now, ADMIN_RETENTION_WEEKS)[0] ?? utcWeekStartKey(now),
  );
  const [sizeRows, activeRows] = yield* Effect.all(
    [
      findCohortSizes({ oldestWeekStart, scope }),
      findMeaningfulCohortActivity({ oldestWeekStart, scope }),
    ],
    { concurrency: "unbounded" },
  );
  const cohortSizes = new Map(sizeRows.map((row) => [row.week, row.value]));
  const activeByCohortWeek = new Map<string, Map<string, number>>();
  for (const row of activeRows) {
    const byWeek = activeByCohortWeek.get(row.signupWeek) ?? new Map<string, number>();
    byWeek.set(row.activityWeek, row.value);
    activeByCohortWeek.set(row.signupWeek, byWeek);
  }
  return { cohortSizes, activeByCohortWeek };
});

/** The start of a UTC day key, as the instant a bound compares against. */
function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Reads everything the Overview shows beyond signups, retention's hosted
 * basis, and the health card. Like the rest of the metrics read, it runs only
 * once the database answered the probe; its runs are UTC days, so the trend
 * runs and the window start on a day's first instant.
 */
export function readAdminOverviewSource(input: {
  now: number;
  scope: AdminMetricsScope;
  windowDays: AdminMetricsWindow;
}): Effect.Effect<AdminOverviewSource, AdminQueryFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const { now, scope, windowDays } = input;
    const trendKeys = lastNDayKeys(now, ADMIN_TREND_DAYS * 2);
    const priorStart = dayStart(trendKeys[0] ?? "");
    const recentStart = dayStart(trendKeys[ADMIN_TREND_DAYS] ?? "");
    const windowStart = dayStart(lastNDayKeys(now, windowDays)[0] ?? "");
    const fetchStart = dayStart(lastNDayKeys(now, windowFetchDays(windowDays))[0] ?? "");

    const [active, dailyRows, prsOpened, funnel, reachRowsRead, ranked, retention] =
      yield* Effect.all(
        [
          findActiveDevelopers({ priorStart, recentStart, scope }),
          findDailyCounts({ since: fetchStart, scope }),
          findPrsOpened({ since: recentStart, scope }),
          findFunnel({ since: windowStart, scope }),
          findReach({ since: recentStart, scope }),
          findTopAccounts({ since: windowStart, scope }),
          readMeaningfulRetention(now, scope),
        ],
        { concurrency: "unbounded" },
      );
    const accountCounts = yield* readAccountCounts(
      ranked.map((row) => row.id),
      windowStart,
    );

    const daily = new Map<DailyCount, Map<string, number>>();
    for (const row of dailyRows) {
      const byDay = daily.get(row.tag) ?? new Map<string, number>();
      byDay.set(row.day, row.value);
      daily.set(row.tag, byDay);
    }

    return {
      activeDevelopers: Option.match(active, {
        onNone: () => ({ recent: 0, prior: 0 }),
        onSome: (row) => ({ recent: row.recent, prior: row.prior }),
      }),
      daily,
      prsOpened: Option.match(prsOpened, {
        onNone: () => ({ opened: 0, merged: 0 }),
        onSome: (row) => ({ opened: row.opened, merged: row.merged }),
      }),
      funnel: Option.match(funnel, {
        onNone: () => new Map<FunnelStep, number>(),
        onSome: (row) =>
          new Map<FunnelStep, number>(Object.values(FUNNEL_STEP).map((step) => [step, row[step]])),
      }),
      reach: new Map<ReachFeature, number>(reachRowsRead.map((row) => [row.tag, row.value])),
      topAccounts: ranked.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        image: row.image,
        admin: isAdminRole(row.role),
        activeDays: row.activeDays,
      })),
      accountCounts,
      retention,
    };
  });
}

/**
 * The whole Overview read: the signup and hosted-retention source and the
 * overview's beside it, at once.
 */
export function readAdminDashboardSources(input: {
  now: number;
  scope: AdminMetricsScope;
  windowDays: AdminMetricsWindow;
}): Effect.Effect<
  { metrics: AdminMetricsSource; overview: AdminOverviewSource },
  AdminQueryFailure,
  DatabaseServices
> {
  return Effect.map(
    Effect.all([readAdminMetricsSource(input), readAdminOverviewSource(input)], {
      concurrency: "unbounded",
    }),
    ([metrics, overview]) => ({ metrics, overview }),
  );
}
