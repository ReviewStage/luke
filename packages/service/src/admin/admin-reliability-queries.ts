import { Database, type DatabaseServices, type QueryError } from "@repo/database/core/query";
import { GITHUB_INSTALLATION_STATUS } from "@repo/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@repo/database/integration-vocabulary";
import { InstantColumnSchema } from "@repo/database/models/columns";
import { utcDayKey } from "@repo/database/models/quota";
import { accountProviderKey } from "@repo/database/schemas/account-provider-key";
import { agentTable } from "@repo/database/schemas/agent";
import { member, user } from "@repo/database/schemas/auth";
import { automationRun } from "@repo/database/schemas/automation";
import { githubInstallation } from "@repo/database/schemas/github-installation";
import { integrationConnection } from "@repo/database/schemas/integration";
import { conversations, turns } from "@repo/database/schemas/storage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import type {
  AdminAttentionAccount,
  AdminAttentionProblem,
  AdminAutomationCount,
  AdminDatabaseHealth,
  AdminFailureCount,
  AdminIntegration,
} from "@repo/features/admin-answer-wire";
import {
  ADMIN_ATTENTION_AGENT_DAYS,
  ADMIN_ATTENTION_KIND,
  type AdminMetricsScope,
  type AdminMetricsWindow,
} from "@repo/features/admin-wire";
import { AGENT_STATUS, type AgentFailure } from "@repo/features/agent-wire";
import {
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  type AutomationRunReason,
} from "@repo/features/automation-wire";
import { INTEGRATION_PROVIDER_LIST } from "@repo/features/integration-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@repo/features/provider-key-wire";
import { and, count, countDistinct, eq, gte, inArray, notExists, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import { Duration, Effect, Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { CODER } from "../agents/coder-host/bounds.js";
import { agentFailureOf, agentStatusOf } from "../agents/coder-host/status.js";
import { DAY_MS, TURN_FAILURE, TURN_STATUS } from "../core.js";
import { isAdminRole } from "./admin-access.js";
import { dayStart, lastNDayKeys } from "./admin-metrics.js";
import {
  AdminMetricsScopeSchema,
  AggregateColumnSchema,
  findAccountFaces,
  keptByScope,
} from "./admin-queries.js";
import { ADMIN_ATTENTION_LIMIT, type AdminReliabilitySource } from "./admin-reliability.js";

type AdminQueryFailure = QueryError | Schema.SchemaError;

const BROKEN_KEY_STATUSES = [
  PROVIDER_KEY_STATUS.INVALID,
  PROVIDER_KEY_STATUS.QUOTA_EXCEEDED,
  PROVIDER_KEY_STATUS.UNREADABLE,
] as const;

const BROKEN_INTEGRATION_STATUSES = [INTEGRATION_ROW_STATUS.EXPIRED] as const;

const BROKEN_INSTALLATION_STATUSES = [
  GITHUB_INSTALLATION_STATUS.SUSPENDED,
  GITHUB_INSTALLATION_STATUS.DELETED,
] as const;

const ENDED_TURN_STATUSES = [TURN_STATUS.SETTLED, TURN_STATUS.CANCELED, TURN_STATUS.FAILED];

const SETTLED_RUN_STATUSES = [
  AUTOMATION_RUN_STATUS.STARTED,
  AUTOMATION_RUN_STATUS.SKIPPED,
  AUTOMATION_RUN_STATUS.FAILED,
];

const probeDatabase = Effect.map(
  Effect.timed(Effect.result(Database.use((db) => db.execute(sql`select 1`)))),
  ([elapsed, probed]) => ({
    reachable: Result.isSuccess(probed),
    latencyMs: Math.round(Duration.toMillis(elapsed)),
  }),
);

const STARTING_GRACE_MS = Duration.toMillis(CODER.STARTING_GRACE);

function utcDayOf(column: PgColumn) {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`;
}

const parentConversation = alias(conversations, "parent_conversation");

const WindowScopeSchema = Schema.Struct({
  windowStart: Schema.Date,
  scope: AdminMetricsScopeSchema,
});

type WindowScope = typeof WindowScopeSchema.Type;

const TURN_DAY = utcDayOf(turns.settledAt);

const findTurnOutcomes = SqlSchema.findAll({
  Request: WindowScopeSchema,
  Result: Schema.Struct({
    day: Schema.String,
    kind: Schema.String,
    parentKind: Schema.NullOr(Schema.String),
    status: Schema.String,
    failure: Schema.NullOr(Schema.String),
    value: AggregateColumnSchema,
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          day: TURN_DAY,
          kind: conversations.kind,
          parentKind: parentConversation.kind,
          status: turns.status,
          failure: turns.failure,
          value: count(),
        })
        .from(turns)
        .innerJoin(conversations, eq(conversations.id, turns.conversationId))
        .leftJoin(parentConversation, eq(parentConversation.id, conversations.parentConversationId))
        .innerJoin(user, eq(user.id, turns.userId))
        .where(
          and(
            gte(turns.settledAt, request.windowStart),
            inArray(turns.status, ENDED_TURN_STATUSES),
            keptByScope(request.scope),
          ),
        )
        .groupBy(
          TURN_DAY,
          conversations.kind,
          parentConversation.kind,
          turns.status,
          turns.failure,
        ),
    ),
});

const findAgentFailures = SqlSchema.findAll({
  Request: WindowScopeSchema,
  Result: Schema.Struct({
    failure: Schema.NullOr(Schema.String),
    failureDetail: Schema.NullOr(Schema.String),
    value: AggregateColumnSchema,
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ failure: turns.failure, failureDetail: turns.failureDetail, value: count() })
        .from(turns)
        .innerJoin(conversations, eq(conversations.id, turns.conversationId))
        .innerJoin(user, eq(user.id, turns.userId))
        .where(
          and(
            gte(turns.settledAt, request.windowStart),
            eq(turns.status, TURN_STATUS.FAILED),
            eq(conversations.kind, CONVERSATION_KIND.AGENT),
            keptByScope(request.scope),
          ),
        )
        .groupBy(turns.failure, turns.failureDetail),
    ),
});

const findTurnlessAgents = SqlSchema.findAll({
  Request: Schema.Struct({ createdSince: Schema.Date, scope: AdminMetricsScopeSchema }),
  Result: Schema.Struct({ createdAt: InstantColumnSchema }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ createdAt: agentTable.createdAt })
        .from(agentTable)
        .innerJoin(user, eq(user.id, agentTable.userId))
        .where(
          and(
            gte(agentTable.createdAt, request.createdSince),
            notExists(
              db
                .select({ id: turns.id })
                .from(turns)
                .where(eq(turns.conversationId, agentTable.conversationId)),
            ),
            keptByScope(request.scope),
          ),
        ),
    ),
});

const RUN_DAY = utcDayOf(automationRun.settledAt);

const findAutomationOutcomes = SqlSchema.findAll({
  Request: WindowScopeSchema,
  Result: Schema.Struct({
    day: Schema.String,
    status: Schema.Literals(SETTLED_RUN_STATUSES),
    reason: Schema.NullOr(Schema.Literals(Object.values(AUTOMATION_RUN_REASON))),
    value: AggregateColumnSchema,
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          day: RUN_DAY,
          status: automationRun.status,
          reason: automationRun.reason,
          value: count(),
        })
        .from(automationRun)
        .innerJoin(user, eq(user.id, automationRun.userId))
        .where(
          and(
            gte(automationRun.settledAt, request.windowStart),
            inArray(automationRun.status, SETTLED_RUN_STATUSES),
            keptByScope(request.scope),
          ),
        )
        .groupBy(RUN_DAY, automationRun.status, automationRun.reason),
    ),
});

const BrokenKeyRowSchema = Schema.Struct({
  userId: Schema.String,
  provider: Schema.Literals(Object.values(PROVIDER_KEY_PROVIDER)),
  status: Schema.Literals(BROKEN_KEY_STATUSES),
  since: InstantColumnSchema,
});

const findBrokenKeys = SqlSchema.findAll({
  Request: AdminMetricsScopeSchema,
  Result: BrokenKeyRowSchema,
  execute: (scope) =>
    Database.use((db) =>
      db
        .select({
          userId: accountProviderKey.userId,
          provider: accountProviderKey.provider,
          status: accountProviderKey.status,
          since: accountProviderKey.statusAt,
        })
        .from(accountProviderKey)
        .innerJoin(user, eq(user.id, accountProviderKey.userId))
        .where(
          and(
            inArray(accountProviderKey.status, BROKEN_KEY_STATUSES),
            eq(accountProviderKey.kind, PROVIDER_KEY_KIND.API_KEY),
            keptByScope(scope),
          ),
        ),
    ),
});

const BrokenIntegrationRowSchema = Schema.Struct({
  userId: Schema.String,
  provider: Schema.Literals(INTEGRATION_PROVIDER_LIST),
  status: Schema.Literals(BROKEN_INTEGRATION_STATUSES),
  since: InstantColumnSchema,
});

const findBrokenIntegrations = SqlSchema.findAll({
  Request: AdminMetricsScopeSchema,
  Result: BrokenIntegrationRowSchema,
  execute: (scope) =>
    Database.use((db) =>
      db
        .select({
          userId: integrationConnection.userId,
          provider: integrationConnection.provider,
          status: integrationConnection.status,
          since: integrationConnection.updatedAt,
        })
        .from(integrationConnection)
        .innerJoin(user, eq(user.id, integrationConnection.userId))
        .where(
          and(
            inArray(integrationConnection.status, BROKEN_INTEGRATION_STATUSES),
            keptByScope(scope),
          ),
        ),
    ),
});

const BrokenInstallationRowSchema = Schema.Struct({
  userId: Schema.String,
  status: Schema.Literals(BROKEN_INSTALLATION_STATUSES),
  since: InstantColumnSchema,
});

const findBrokenInstallations = SqlSchema.findAll({
  Request: AdminMetricsScopeSchema,
  Result: BrokenInstallationRowSchema,
  execute: (scope) =>
    Database.use((db) =>
      db
        .select({
          userId: member.userId,
          status: githubInstallation.status,
          since: githubInstallation.updatedAt,
        })
        .from(githubInstallation)
        .innerJoin(member, eq(member.organizationId, githubInstallation.organizationId))
        .innerJoin(user, eq(user.id, member.userId))
        .where(
          and(inArray(githubInstallation.status, BROKEN_INSTALLATION_STATUSES), keptByScope(scope)),
        ),
    ),
});

const findFailedAgentCounts = SqlSchema.findAll({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String), since: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String, value: AggregateColumnSchema }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ userId: agentTable.userId, value: countDistinct(agentTable.id) })
        .from(agentTable)
        .innerJoin(turns, eq(turns.conversationId, agentTable.conversationId))
        .where(
          and(
            inArray(agentTable.userId, [...request.ids]),
            eq(turns.status, TURN_STATUS.FAILED),
            gte(turns.settledAt, request.since),
          ),
        )
        .groupBy(agentTable.userId),
    ),
});

function bump<Count>(
  map: Map<string, Count>,
  day: string,
  empty: Count,
  change: (count: Count) => Count,
): void {
  map.set(day, change(map.get(day) ?? empty));
}

const NO_FAILURES: AdminFailureCount = { failed: 0, total: 0 };

const NO_RUNS: AdminAutomationCount = { failed: 0, skipped: 0, total: 0 };

const TURN_WORK = {
  APP: "app",
  AGENT: "agent",
  AGENT_SUBAGENT: "agent-subagent",
} as const;

type TurnWork = (typeof TURN_WORK)[keyof typeof TURN_WORK];

function turnWorkOf(kind: string, parentKind: string | null): TurnWork {
  if (kind === CONVERSATION_KIND.AGENT) return TURN_WORK.AGENT;
  if (parentKind === CONVERSATION_KIND.AGENT) return TURN_WORK.AGENT_SUBAGENT;
  return TURN_WORK.APP;
}

const readTurnSeries = /* @__PURE__ */ Effect.fn("web/readReliabilityTurns")(function* (
  request: WindowScope,
  now: number,
) {
  const [outcomes, failures, turnless] = yield* Effect.all(
    [
      findTurnOutcomes(request),
      findAgentFailures(request),
      findTurnlessAgents({
        createdSince: new Date(request.windowStart.getTime() - STARTING_GRACE_MS),
        scope: request.scope,
      }),
    ],
    { concurrency: "unbounded" },
  );

  const appTurns = new Map<string, AdminFailureCount>();
  const agentRuns = new Map<string, AdminFailureCount>();
  const abandonedTurns = new Map<string, number>();
  for (const row of outcomes) {
    const failed = row.status === TURN_STATUS.FAILED ? row.value : 0;
    if (row.failure === TURN_FAILURE.ABANDONED) {
      bump(abandonedTurns, row.day, 0, (counted) => counted + row.value);
    }
    const work = turnWorkOf(row.kind, row.parentKind);
    if (work === TURN_WORK.AGENT_SUBAGENT) continue;
    bump(work === TURN_WORK.AGENT ? agentRuns : appTurns, row.day, NO_FAILURES, (counted) => ({
      failed: counted.failed + failed,
      total: counted.total + row.value,
    }));
  }

  const agentFailures = new Map<AgentFailure, number>();
  for (const row of failures) {
    const failure = agentFailureOf({
      status: TURN_STATUS.FAILED,
      failure: row.failure,
      failureDetail: row.failureDetail,
    });
    if (failure !== undefined)
      agentFailures.set(failure, (agentFailures.get(failure) ?? 0) + row.value);
  }

  for (const agent of turnless) {
    const status = agentStatusOf(undefined, { createdAt: agent.createdAt, now });
    const failure = agentFailureOf(undefined);
    const failedAt = agent.createdAt.getTime() + STARTING_GRACE_MS;
    if (status !== AGENT_STATUS.FAILED || failure === undefined) continue;
    if (failedAt < request.windowStart.getTime()) continue;
    bump(agentRuns, utcDayKey(failedAt), NO_FAILURES, (counted) => ({
      failed: counted.failed + 1,
      total: counted.total + 1,
    }));
    agentFailures.set(failure, (agentFailures.get(failure) ?? 0) + 1);
  }

  return { appTurns, agentRuns, abandonedTurns, agentFailures };
});

const readAutomationSeries = /* @__PURE__ */ Effect.fn("web/readReliabilityAutomations")(function* (
  request: WindowScope,
) {
  const automationRuns = new Map<string, AdminAutomationCount>();
  const automationReasons = new Map<
    AutomationRunReason | null,
    { skipped: number; failed: number }
  >();
  for (const row of yield* findAutomationOutcomes(request)) {
    const failed = row.status === AUTOMATION_RUN_STATUS.FAILED ? row.value : 0;
    const skipped = row.status === AUTOMATION_RUN_STATUS.SKIPPED ? row.value : 0;
    bump(automationRuns, row.day, NO_RUNS, (counted) => ({
      failed: counted.failed + failed,
      skipped: counted.skipped + skipped,
      total: counted.total + row.value,
    }));
    if (failed + skipped === 0) continue;
    const reason = automationReasons.get(row.reason) ?? { skipped: 0, failed: 0 };
    automationReasons.set(row.reason, {
      skipped: reason.skipped + skipped,
      failed: reason.failed + failed,
    });
  }
  return { automationRuns, automationReasons };
});

function problemsByAccount(
  keys: readonly (typeof BrokenKeyRowSchema.Type)[],
  integrations: readonly (typeof BrokenIntegrationRowSchema.Type)[],
  installations: readonly (typeof BrokenInstallationRowSchema.Type)[],
): Map<string, AdminAttentionProblem[]> {
  const byAccount = new Map<string, AdminAttentionProblem[]>();
  const add = (userId: string, problem: AdminAttentionProblem) => {
    byAccount.set(userId, [...(byAccount.get(userId) ?? []), problem]);
  };
  for (const row of keys) {
    add(row.userId, {
      kind: ADMIN_ATTENTION_KIND.PROVIDER_KEY,
      provider: row.provider,
      status: row.status,
      since: row.since.getTime(),
    });
  }
  for (const row of integrations) {
    add(row.userId, {
      kind: ADMIN_ATTENTION_KIND.INTEGRATION,
      provider: row.provider,
      status: row.status,
      since: row.since.getTime(),
    });
  }
  for (const row of installations) {
    const problems = byAccount.get(row.userId) ?? [];
    const same = problems.find(
      (problem) =>
        problem.kind === ADMIN_ATTENTION_KIND.GITHUB_INSTALLATION && problem.status === row.status,
    );
    if (same !== undefined) {
      same.since = Math.max(same.since, row.since.getTime());
      continue;
    }
    add(row.userId, {
      kind: ADMIN_ATTENTION_KIND.GITHUB_INSTALLATION,
      status: row.status,
      since: row.since.getTime(),
    });
  }
  return byAccount;
}

const readAttention = /* @__PURE__ */ Effect.fn("web/readReliabilityAttention")(function* (
  scope: AdminMetricsScope,
  now: number,
) {
  const [keys, integrations, installations] = yield* Effect.all(
    [findBrokenKeys(scope), findBrokenIntegrations(scope), findBrokenInstallations(scope)],
    { concurrency: "unbounded" },
  );
  const byAccount = problemsByAccount(keys, integrations, installations);
  const newest = (problems: readonly AdminAttentionProblem[]) =>
    Math.max(...problems.map((problem) => problem.since));
  const listed = [...byAccount]
    .map(([id, problems]) => ({
      id,
      brokenSince: newest(problems),
      problems: [...problems].sort((left, right) => right.since - left.since),
    }))
    .sort((left, right) => right.brokenSince - left.brokenSince || left.id.localeCompare(right.id))
    .slice(0, ADMIN_ATTENTION_LIMIT);
  if (listed.length === 0) return { total: 0, accounts: [] };

  const ids = listed.map((row) => row.id);
  const [accountRows, failedRows] = yield* Effect.all(
    [
      findAccountFaces(ids),
      findFailedAgentCounts({ ids, since: new Date(now - ADMIN_ATTENTION_AGENT_DAYS * DAY_MS) }),
    ],
    { concurrency: "unbounded" },
  );
  const accountById = new Map(accountRows.map((row) => [row.id, row]));
  const failedById = new Map(failedRows.map((row) => [row.userId, row.value]));

  const accounts: AdminAttentionAccount[] = listed.flatMap((row) => {
    const account = accountById.get(row.id);
    if (account === undefined) return [];
    return [
      {
        id: account.id,
        name: account.name,
        email: account.email,
        image: account.image,
        admin: isAdminRole(account.role),
        brokenSince: row.brokenSince,
        problems: row.problems,
        failedAgents: failedById.get(row.id) ?? 0,
      },
    ];
  });
  return { total: byAccount.size, accounts };
});

function emptySource(
  database: AdminDatabaseHealth,
  integrations: readonly AdminIntegration[],
  analyticsConsoleUrl: string | undefined,
): AdminReliabilitySource {
  return {
    daily: {
      appTurns: new Map(),
      agentRuns: new Map(),
      abandonedTurns: new Map(),
      automationRuns: new Map(),
    },
    agentFailures: new Map(),
    automationReasons: new Map(),
    attention: { total: 0, accounts: [] },
    analyticsConsoleUrl,
    systemHealth: { database, integrations },
  };
}

export function readAdminReliabilitySource(input: {
  now: number;
  scope: AdminMetricsScope;
  windowDays: AdminMetricsWindow;
  integrations: readonly AdminIntegration[];
  analyticsConsoleUrl?: string | undefined;
}): Effect.Effect<AdminReliabilitySource, AdminQueryFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const database = yield* probeDatabase;
    if (!database.reachable) {
      return emptySource(database, input.integrations, input.analyticsConsoleUrl);
    }

    const windowStartDay = lastNDayKeys(input.now, input.windowDays)[0] ?? utcDayKey(input.now);
    const request = {
      windowStart: dayStart(windowStartDay),
      scope: input.scope,
    };

    const [turnSeries, automations, attention] = yield* Effect.all(
      [
        readTurnSeries(request, input.now),
        readAutomationSeries(request),
        readAttention(input.scope, input.now),
      ],
      { concurrency: "unbounded" },
    );

    return {
      daily: {
        appTurns: turnSeries.appTurns,
        agentRuns: turnSeries.agentRuns,
        abandonedTurns: turnSeries.abandonedTurns,
        automationRuns: automations.automationRuns,
      },
      agentFailures: turnSeries.agentFailures,
      automationReasons: automations.automationReasons,
      attention,
      analyticsConsoleUrl: input.analyticsConsoleUrl,
      systemHealth: { database, integrations: input.integrations },
    };
  });
}
