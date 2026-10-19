/**
 * admin-reliability-queries.ts -- the Reliability screen's reads, from the
 * rows the service already writes for its own operation.
 *
 * Every read is an aggregate or a status word, counted through the account's
 * user row so the scope that hides the maintainers' own accounts holds on
 * each. A coding agent's failure is classed by the coder host's own reading
 * (`coder-host/status.ts`), handed the turn's failure word and detail here,
 * on the server, so the detail is read and never answered.
 */

import { Database, type DatabaseServices, type QueryError } from "@luke/database/core/query";
import { GITHUB_INSTALLATION_STATUS } from "@luke/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import { InstantColumnSchema } from "@luke/database/models/columns";
import { utcDayKey } from "@luke/database/models/quota";
import { accountProviderKey } from "@luke/database/schemas/account-provider-key";
import { member, user } from "@luke/database/schemas/auth";
import { automationRun } from "@luke/database/schemas/automation";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { integrationConnection } from "@luke/database/schemas/integration";
import { conversations, turns } from "@luke/database/schemas/storage";
import { voiceSessions } from "@luke/database/schemas/voice";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { VOICE_CLOSE_REASON } from "@luke/database/voice-vocabulary";
import {
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  type AutomationRunReason,
} from "@luke/features/automation-wire";
import { CODING_AGENT_STATUS, type CodingAgentFailure } from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { PROVIDER_KEY_PROVIDER, PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import { and, count, countDistinct, eq, gte, inArray, notExists, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import { Duration, Effect, Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { CODER } from "../agents/coder-host/bounds.js";
import { codingAgentFailureOf, codingAgentStatusOf } from "../agents/coder-host/status.js";
import { BRAIN_REQUEST_FAILURE, DAY_MS, TURN_STATUS } from "../core.js";
import { isAdminRole } from "./admin-access.js";
import type { AdminDatabaseHealth, AdminIntegration } from "./admin-health.js";
import { lastNDayKeys } from "./admin-metrics.js";
import {
  AdminMetricsScopeSchema,
  AggregateColumnSchema,
  keptByScope,
  UserRoleSchema,
} from "./admin-queries.js";
import {
  ADMIN_ATTENTION_LIMIT,
  type AdminAttentionAccount,
  type AdminAttentionProblem,
  type AdminAutomationCount,
  type AdminFailureCount,
  type AdminReliabilitySource,
} from "./admin-reliability.js";
import {
  ADMIN_ATTENTION_AGENT_DAYS,
  ADMIN_ATTENTION_KIND,
  type AdminMetricsScope,
  type AdminMetricsWindow,
} from "./http.js";

type AdminQueryFailure = QueryError | Schema.SchemaError;

/** The provider-key statuses that leave the key unused: refused, out of quota, or unreadable. */
const BROKEN_KEY_STATUSES = [
  PROVIDER_KEY_STATUS.INVALID,
  PROVIDER_KEY_STATUS.QUOTA_EXCEEDED,
  PROVIDER_KEY_STATUS.UNREADABLE,
] as const;

/** The integration status that leaves a connection unused; no other row status is a breakage. */
const BROKEN_INTEGRATION_STATUSES = [INTEGRATION_ROW_STATUS.EXPIRED] as const;

/** The installation statuses that leave a workspace's repositories out of reach. */
const BROKEN_INSTALLATION_STATUSES = [
  GITHUB_INSTALLATION_STATUS.SUSPENDED,
  GITHUB_INSTALLATION_STATUS.DELETED,
] as const;

/** The turn statuses that mean the turn ended, which is what a failure rate is a share of. */
const ENDED_TURN_STATUSES = [TURN_STATUS.SETTLED, TURN_STATUS.CANCELLED, TURN_STATUS.FAILED];

/** The automation-run statuses a run settles in. */
const SETTLED_RUN_STATUSES = [
  AUTOMATION_RUN_STATUS.STARTED,
  AUTOMATION_RUN_STATUS.SKIPPED,
  AUTOMATION_RUN_STATUS.FAILED,
];

/**
 * Whether the database answers at all, and how long it took. A failure is the
 * answer rather than the read's, because the health card is what reports it.
 */
const probeDatabase = Effect.map(
  Effect.timed(Effect.result(Database.use((db) => db.execute(sql`select 1`)))),
  ([elapsed, probed]) => ({
    reachable: Result.isSuccess(probed),
    latencyMs: Math.round(Duration.toMillis(elapsed)),
  }),
);

/** How long a coding agent's first turn may take to land before the coder host reads it failed. */
const STARTING_GRACE_MS = Duration.toMillis(CODER.STARTING_GRACE);

/** The UTC day an instant column falls on, as the YYYY-MM-DD key the series is built from. */
function utcDayOf(column: PgColumn) {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`;
}

/** The conversation a child conversation was delegated from, to tell a coding agent's subagent from Luke's. */
const parentConversation = alias(conversations, "parent_conversation");

const WindowScopeSchema = Schema.Struct({
  windowStart: Schema.Date,
  scope: AdminMetricsScopeSchema,
});

type WindowScope = typeof WindowScopeSchema.Type;

const TURN_DAY = utcDayOf(turns.settledAt);

/**
 * Every ended turn of the window, by its day, its conversation's kind and
 * its parent's, its status, and its failure word. Grouped on the columns
 * themselves rather than a case over them, so the fold below decides which
 * turns are Luke's and which a coding agent's.
 */
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

/**
 * The window's failed coding-agent turns by failure word and detail, each
 * distinct pair once: the detail is cut at its write to a few hundred
 * characters, so the pairs stay few, and it is read only to be classed.
 */
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
            eq(conversations.kind, CONVERSATION_KIND.CODING_AGENT),
            keptByScope(request.scope),
          ),
        )
        .groupBy(turns.failure, turns.failureDetail),
    ),
});

/**
 * The coding agents no turn was ever written for whose starting grace ends
 * inside the window, which reaches back a grace before it opens. Whether
 * each is still inside its grace or failed to start is the coder host's own
 * reading, made in the fold.
 */
const findTurnlessAgents = SqlSchema.findAll({
  Request: Schema.Struct({ createdSince: Schema.Date, scope: AdminMetricsScopeSchema }),
  Result: Schema.Struct({ createdAt: InstantColumnSchema }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ createdAt: codingAgent.createdAt })
        .from(codingAgent)
        .innerJoin(user, eq(user.id, codingAgent.userId))
        .where(
          and(
            gte(codingAgent.createdAt, request.createdSince),
            notExists(
              db
                .select({ id: turns.id })
                .from(turns)
                .where(eq(turns.conversationId, codingAgent.conversationId)),
            ),
            keptByScope(request.scope),
          ),
        ),
    ),
});

const CALL_DAY = utcDayOf(voiceSessions.closedAt);

const findCallOutcomes = SqlSchema.findAll({
  Request: WindowScopeSchema,
  Result: Schema.Struct({
    day: Schema.String,
    closeReason: Schema.NullOr(Schema.String),
    value: AggregateColumnSchema,
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ day: CALL_DAY, closeReason: voiceSessions.closeReason, value: count() })
        .from(voiceSessions)
        .innerJoin(user, eq(user.id, voiceSessions.userId))
        .where(and(gte(voiceSessions.closedAt, request.windowStart), keptByScope(request.scope)))
        .groupBy(CALL_DAY, voiceSessions.closeReason),
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
        .where(and(inArray(accountProviderKey.status, BROKEN_KEY_STATUSES), keptByScope(scope))),
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

/** Every member of a workspace whose GitHub installation stands suspended or deleted; the workspace itself is never read. */
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

const findAttentionAccounts = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: Schema.NullOr(Schema.String),
    role: UserRoleSchema,
  }),
  execute: (ids) =>
    Database.use((db) =>
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        })
        .from(user)
        .where(inArray(user.id, [...ids])),
    ),
});

/** Each account's coding agents with a turn that failed since the bound, each agent once. */
const findFailedAgentCounts = SqlSchema.findAll({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String), since: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String, value: AggregateColumnSchema }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ userId: codingAgent.userId, value: countDistinct(codingAgent.id) })
        .from(codingAgent)
        .innerJoin(turns, eq(turns.conversationId, codingAgent.conversationId))
        .where(
          and(
            inArray(codingAgent.userId, [...request.ids]),
            eq(turns.status, TURN_STATUS.FAILED),
            gte(turns.settledAt, request.since),
          ),
        )
        .groupBy(codingAgent.userId),
    ),
});

/** One day's count bumped in place, the empty count first where the day has none. */
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

/** Whose work a turn is: Luke's, a coding agent's own run, or a subagent one of its turns delegated to. */
const TURN_WORK = {
  LUKE: "luke",
  AGENT: "agent",
  AGENT_SUBAGENT: "agent-subagent",
} as const;

type TurnWork = (typeof TURN_WORK)[keyof typeof TURN_WORK];

function turnWorkOf(kind: string, parentKind: string | null): TurnWork {
  if (kind === CONVERSATION_KIND.CODING_AGENT) return TURN_WORK.AGENT;
  if (parentKind === CONVERSATION_KIND.CODING_AGENT) return TURN_WORK.AGENT_SUBAGENT;
  return TURN_WORK.LUKE;
}

/**
 * The turn and agent series and the failure classes. A coding agent's run is
 * a turn of its own conversation, or a Start that never got one; its
 * subagents' turns run inside that turn, so they count toward neither rate.
 * Every other ended turn is Luke's. An abandoned turn counts whatever its
 * kind.
 */
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

  const lukeTurns = new Map<string, AdminFailureCount>();
  const agentRuns = new Map<string, AdminFailureCount>();
  const abandonedTurns = new Map<string, number>();
  for (const row of outcomes) {
    const failed = row.status === TURN_STATUS.FAILED ? row.value : 0;
    if (row.failure === BRAIN_REQUEST_FAILURE.ABANDONED) {
      bump(abandonedTurns, row.day, 0, (counted) => counted + row.value);
    }
    const work = turnWorkOf(row.kind, row.parentKind);
    if (work === TURN_WORK.AGENT_SUBAGENT) continue;
    bump(work === TURN_WORK.AGENT ? agentRuns : lukeTurns, row.day, NO_FAILURES, (counted) => ({
      failed: counted.failed + failed,
      total: counted.total + row.value,
    }));
  }

  const agentFailures = new Map<CodingAgentFailure, number>();
  for (const row of failures) {
    const failure = codingAgentFailureOf({
      status: TURN_STATUS.FAILED,
      failure: row.failure,
      failureDetail: row.failureDetail,
    });
    if (failure !== undefined)
      agentFailures.set(failure, (agentFailures.get(failure) ?? 0) + row.value);
  }

  // An agent with no turn is a run only once the coder host reads it failed,
  // one still inside its starting grace neither, and its run failed the
  // moment the grace ran out, which is the day it counts on and what keeps
  // it inside the window or out.
  for (const agent of turnless) {
    const status = codingAgentStatusOf(undefined, { createdAt: agent.createdAt, now });
    const failure = codingAgentFailureOf(undefined);
    const failedAt = agent.createdAt.getTime() + STARTING_GRACE_MS;
    if (status !== CODING_AGENT_STATUS.FAILED || failure === undefined) continue;
    if (failedAt < request.windowStart.getTime()) continue;
    bump(agentRuns, utcDayKey(failedAt), NO_FAILURES, (counted) => ({
      failed: counted.failed + 1,
      total: counted.total + 1,
    }));
    agentFailures.set(failure, (agentFailures.get(failure) ?? 0) + 1);
  }

  return { lukeTurns, agentRuns, abandonedTurns, agentFailures };
});

const readCallSeries = /* @__PURE__ */ Effect.fn("web/readReliabilityCalls")(function* (
  request: WindowScope,
) {
  const calls = new Map<string, AdminFailureCount>();
  for (const row of yield* findCallOutcomes(request)) {
    const dropped = row.closeReason === VOICE_CLOSE_REASON.CONNECTION_LOST ? row.value : 0;
    bump(calls, row.day, NO_FAILURES, (counted) => ({
      failed: counted.failed + dropped,
      total: counted.total + row.value,
    }));
  }
  return calls;
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

/**
 * Folds every broken row into its account's problems. An account in several
 * workspaces whose installations broke the same way reads that once, at the
 * newest instant, because no workspace is named to tell them apart.
 */
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

/**
 * The accounts with something broken, newest breakage first and cut at the
 * bound, each with its account fields and how many of its coding agents
 * failed in the last week. The total counts every such account.
 */
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
      findAttentionAccounts(ids),
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
      lukeTurns: new Map(),
      agentRuns: new Map(),
      abandonedTurns: new Map(),
      calls: new Map(),
      automationRuns: new Map(),
    },
    agentFailures: new Map(),
    automationReasons: new Map(),
    attention: { total: 0, accounts: [] },
    analyticsConsoleUrl,
    systemHealth: { database, integrations },
  };
}

/**
 * Reads everything the Reliability screen shows. A database that does not
 * answer the probe short-circuits to an empty source whose health card says
 * so, rather than a page of zeros under a green light; the providers and the
 * analytics console, read from the environment, still fill in.
 */
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
      windowStart: new Date(`${windowStartDay}T00:00:00.000Z`),
      scope: input.scope,
    };

    const [turnSeries, calls, automations, attention] = yield* Effect.all(
      [
        readTurnSeries(request, input.now),
        readCallSeries(request),
        readAutomationSeries(request),
        readAttention(input.scope, input.now),
      ],
      { concurrency: "unbounded" },
    );

    return {
      daily: {
        lukeTurns: turnSeries.lukeTurns,
        agentRuns: turnSeries.agentRuns,
        abandonedTurns: turnSeries.abandonedTurns,
        calls,
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
