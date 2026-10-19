/**
 * admin-account-queries.ts -- the rows one account's support sections are folded from.
 *
 * Every read names the account by its id, as the account page's other reads
 * do, so the overview's admin scope has nothing to narrow here. No read
 * selects a column the page may not show: a task's name or document, an
 * agent's title, prompt, plan, or pull request beyond its state, a turn's
 * detail beyond what `coder-host/status.ts` reads it for, a key's sealed
 * parts or hint, or a connection's label. A workspace's name and an
 * agent's repository are read, which the developer allowed the admin pages. `admin-account.ts` folds what they answer.
 */

import { Database, type DatabaseServices, type QueryError } from "@luke/database/core/query";
import { GITHUB_INSTALLATION_STATUS } from "@luke/database/github-installation-vocabulary";
import {
  awaitingLinesOfReached,
  latestTurnsOfReached,
} from "@luke/database/models/coding-agent-store";
import { InstantColumnSchema } from "@luke/database/models/columns";
import { utcDayKey } from "@luke/database/models/quota";
import { accountProviderKey } from "@luke/database/schemas/account-provider-key";
import { member, organization, session } from "@luke/database/schemas/auth";
import { automation, automationRun } from "@luke/database/schemas/automation";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { integrationConnection } from "@luke/database/schemas/integration";
import { personalWorkspace } from "@luke/database/schemas/personal-workspace";
import { accountPreference } from "@luke/database/schemas/preferences";
import { task } from "@luke/database/schemas/task";
import { voiceSessionUsage } from "@luke/database/schemas/usage";
import { voiceSessions } from "@luke/database/schemas/voice";
import { VOICE_CLOSE_REASON } from "@luke/database/voice-vocabulary";
import { AUTOMATION_RUN_REASON, AUTOMATION_RUN_STATUS } from "@luke/features/automation-wire";
import { CONTEXT_WINDOW, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  FAST_ACCESS,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { experimentChoicesFrom, NO_EXPERIMENTS } from "@luke/settings";
import { WireValueSchema } from "@luke/wire";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, max, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import {
  ADMIN_ACCOUNT_FAILURES_LIMIT,
  ADMIN_ACCOUNT_STATUS_READ_LIMIT,
  ADMIN_RECENT_AGENTS_LIMIT,
  type AdminAccountAgentSource,
  type AdminAccountSource,
} from "./admin-account.js";
import { lastNDayKeys } from "./admin-metrics.js";
import { AggregateColumnSchema } from "./admin-queries.js";
import type { AdminMetricsWindow } from "./http.js";

type AdminQueryFailure = QueryError | Schema.SchemaError;

const NullableAggregateColumnSchema = Schema.NullOr(AggregateColumnSchema);

/** The account, and the instant the window opens: its first UTC day's midnight. */
const WindowRequestSchema = Schema.Struct({ userId: Schema.String, windowStart: Schema.Date });

/** The state of an agent's pull request alone, out of the row GitHub's answer was kept in. */
const PULL_REQUEST_STATE_OF = sql<string | null>`${codingAgent.published} ->> 'state'`;

const findSessionSeen = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ seenAt: Schema.NullOr(InstantColumnSchema) }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ seenAt: max(session.updatedAt) })
        .from(session)
        .where(eq(session.userId, userId)),
    ),
});

const findTasksCreated = SqlSchema.findOneOption({
  Request: WindowRequestSchema,
  Result: Schema.Struct({ value: AggregateColumnSchema }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ value: count() })
        .from(task)
        .where(and(eq(task.userId, request.userId), gte(task.createdAt, request.windowStart))),
    ),
});

/**
 * The window's agents counted whole, with the pull requests opened from
 * them and the ones of those merged, each a count of rows rather than of
 * the bounded read the statuses come from.
 */
const findAgentTotals = SqlSchema.findOneOption({
  Request: WindowRequestSchema,
  Result: Schema.Struct({
    started: AggregateColumnSchema,
    opened: AggregateColumnSchema,
    merged: AggregateColumnSchema,
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          started: count(),
          opened: count(codingAgent.published),
          merged: sql<number>`count(*) filter (where ${PULL_REQUEST_STATE_OF} = ${PULL_REQUEST_STATE.MERGED})`,
        })
        .from(codingAgent)
        .where(
          and(
            eq(codingAgent.userId, request.userId),
            gte(codingAgent.createdAt, request.windowStart),
          ),
        ),
    ),
});

const AgentRowSchema = Schema.Struct({
  id: Schema.String,
  conversationId: Schema.String,
  createdAt: InstantColumnSchema,
  repository: Schema.String,
  model: Schema.String,
  effort: Schema.String,
  contextWindow: Schema.Literals(Object.values(CONTEXT_WINDOW)),
  pullRequestState: Schema.NullOr(Schema.Literals(Object.values(PULL_REQUEST_STATE))),
});

type AgentRow = typeof AgentRowSchema.Type;

const AGENT_COLUMNS = {
  id: codingAgent.id,
  conversationId: codingAgent.conversationId,
  createdAt: codingAgent.createdAt,
  repository: codingAgent.repository,
  model: codingAgent.model,
  effort: codingAgent.effort,
  contextWindow: codingAgent.contextWindow,
  pullRequestState: PULL_REQUEST_STATE_OF,
};

/** The account's newest agents started since `windowStart`, at most `limit`, the id breaking a tie in their start. */
const findAgents = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    windowStart: Schema.NullOr(Schema.Date),
    limit: Schema.Number,
  }),
  Result: AgentRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(AGENT_COLUMNS)
        .from(codingAgent)
        .where(
          and(
            eq(codingAgent.userId, request.userId),
            request.windowStart === null
              ? undefined
              : gte(codingAgent.createdAt, request.windowStart),
          ),
        )
        .orderBy(desc(codingAgent.createdAt), desc(codingAgent.id))
        .limit(request.limit),
    ),
});

/** Seconds of call time the voice service reported for the account inside the window. */
const findCallSeconds = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, windowStartMs: Schema.Number }),
  Result: Schema.Struct({ seconds: NullableAggregateColumnSchema }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ seconds: sum(voiceSessionUsage.seconds) })
        .from(voiceSessionUsage)
        .where(
          and(
            eq(voiceSessionUsage.userId, request.userId),
            gte(voiceSessionUsage.recordedAt, request.windowStartMs),
          ),
        ),
    ),
});

/** The window's calls that ended on a lost connection, newest first. */
const findDroppedCalls = SqlSchema.findAll({
  Request: WindowRequestSchema,
  Result: Schema.Struct({ at: InstantColumnSchema }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ at: voiceSessions.closedAt })
        .from(voiceSessions)
        .where(
          and(
            eq(voiceSessions.userId, request.userId),
            eq(voiceSessions.closeReason, VOICE_CLOSE_REASON.CONNECTION_LOST),
            gte(voiceSessions.closedAt, request.windowStart),
          ),
        )
        .orderBy(desc(voiceSessions.closedAt))
        .limit(ADMIN_ACCOUNT_FAILURES_LIMIT),
    ),
});

/** Every member of a workspace the account is in, joined back to count them. */
const fellow = alias(member, "fellow");

/**
 * The account's memberships with each workspace's name and member count,
 * oldest joined first, and whether it is the account's personal workspace.
 */
const findMemberships = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    role: Schema.String,
    memberCount: AggregateColumnSchema,
    personal: Schema.Boolean,
  }),
  execute: (userId) => {
    const personal = sql<boolean>`bool_or(${isNotNull(personalWorkspace.userId)})`;
    return Database.use((db) =>
      db
        .select({
          id: member.organizationId,
          name: organization.name,
          role: member.role,
          memberCount: count(fellow.id),
          personal,
        })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .innerJoin(fellow, eq(fellow.organizationId, member.organizationId))
        .leftJoin(
          personalWorkspace,
          and(
            eq(personalWorkspace.organizationId, member.organizationId),
            eq(personalWorkspace.userId, member.userId),
          ),
        )
        .where(eq(member.userId, userId))
        .groupBy(member.id, member.organizationId, organization.name, member.role, member.createdAt)
        .orderBy(asc(member.createdAt), asc(member.organizationId)),
    );
  },
});

/** The GitHub installations of every workspace the account is in, by workspace. */
const findInstallations = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    organizationId: Schema.String,
    status: Schema.Literals(Object.values(GITHUB_INSTALLATION_STATUS)),
  }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          organizationId: githubInstallation.organizationId,
          status: githubInstallation.status,
        })
        .from(githubInstallation)
        .where(
          inArray(
            githubInstallation.organizationId,
            db.select({ id: member.organizationId }).from(member).where(eq(member.userId, userId)),
          ),
        )
        .orderBy(asc(githubInstallation.createdAt)),
    ),
});

/** The account's provider keys: which provider, how it last answered, and fast access; never the key, sealed or hinted. */
const findProviderKeys = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    provider: Schema.Literals(Object.values(PROVIDER_KEY_PROVIDER)),
    status: Schema.Literals(Object.values(PROVIDER_KEY_STATUS)),
    statusAt: InstantColumnSchema,
    fastAccess: Schema.NullOr(Schema.Literals(Object.values(FAST_ACCESS))),
  }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          provider: accountProviderKey.provider,
          status: accountProviderKey.status,
          statusAt: accountProviderKey.statusAt,
          fastAccess: accountProviderKey.fastAccess,
        })
        .from(accountProviderKey)
        .where(eq(accountProviderKey.userId, userId))
        .orderBy(asc(accountProviderKey.provider)),
    ),
});

/** The account's integration connections: which provider, its status, and when that last moved; never its label. */
const findConnections = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    provider: Schema.Literals(Object.values(INTEGRATION_PROVIDER)),
    status: Schema.String,
    at: InstantColumnSchema,
  }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          provider: integrationConnection.provider,
          status: integrationConnection.status,
          at: integrationConnection.updatedAt,
        })
        .from(integrationConnection)
        .where(eq(integrationConnection.userId, userId))
        .orderBy(asc(integrationConnection.provider), asc(integrationConnection.connectionName)),
    ),
});

const findDefaults = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({
    model: Schema.NullOr(Schema.String),
    effort: Schema.NullOr(Schema.String),
    contextWindow: Schema.NullOr(Schema.Literals(Object.values(CONTEXT_WINDOW))),
    experiments: Schema.NullOr(WireValueSchema),
  }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          model: accountPreference.codingAgentModel,
          effort: accountPreference.codingAgentEffort,
          contextWindow: accountPreference.codingAgentContextWindow,
          experiments: accountPreference.experiments,
        })
        .from(accountPreference)
        .where(eq(accountPreference.userId, userId)),
    ),
});

/** The window's failed runs of automations the account made, newest first, with the enumerated reason alone. */
const findFailedRuns = SqlSchema.findAll({
  Request: WindowRequestSchema,
  Result: Schema.Struct({
    at: InstantColumnSchema,
    reason: Schema.NullOr(Schema.Literals(Object.values(AUTOMATION_RUN_REASON))),
  }),
  execute: (request) => {
    const at = sql<Date>`coalesce(${automationRun.settledAt}, ${automationRun.firedAt})`;
    return Database.use((db) =>
      db
        .select({ at, reason: automationRun.reason })
        .from(automationRun)
        .innerJoin(automation, eq(automation.id, automationRun.automationId))
        .where(
          and(
            eq(automation.userId, request.userId),
            eq(automationRun.status, AUTOMATION_RUN_STATUS.FAILED),
            gte(automationRun.firedAt, request.windowStart),
          ),
        )
        .orderBy(desc(automationRun.firedAt))
        .limit(ADMIN_ACCOUNT_FAILURES_LIMIT),
    );
  },
});

/** Each agent read, with the newest turn and the awaiting line its status is read from. */
const withStandings = Effect.fnUntraced(function* (
  windowRows: readonly AgentRow[],
  recentRows: readonly AgentRow[],
) {
  // Note that the conversations are the agents' own, read above by the account's id, so
  // the reads that need no owner take them as already reached.
  const conversations = [
    ...new Set([...windowRows, ...recentRows].map((row) => row.conversationId)),
  ];
  const [turns, awaiting] = yield* Effect.all(
    [latestTurnsOfReached(conversations), awaitingLinesOfReached(conversations)],
    { concurrency: "unbounded" },
  );
  const standing = (row: AgentRow): AdminAccountAgentSource => ({
    id: row.id,
    createdAt: row.createdAt,
    repository: row.repository,
    model: row.model,
    effort: row.effort,
    contextWindow: row.contextWindow,
    pullRequestState: row.pullRequestState,
    turn: turns.get(row.conversationId),
    awaitingLineAt: awaiting.get(row.conversationId),
  });
  return { windowAgents: windowRows.map(standing), recentAgents: recentRows.map(standing) };
});

/**
 * Reads every row one account's support sections are folded from, over the
 * window ending at `now`. Like the rest of the account page, a database
 * that does not answer throws into the handler's 503. An account with no
 * user row reads as an empty source; the page's own account read is what
 * answers it missing.
 */
export function readAdminAccountSource(input: {
  userId: string;
  now: number;
  windowDays: AdminMetricsWindow;
}): Effect.Effect<AdminAccountSource, AdminQueryFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const { userId } = input;
    const windowStartDay = lastNDayKeys(input.now, input.windowDays)[0] ?? utcDayKey(input.now);
    const windowStart = new Date(`${windowStartDay}T00:00:00.000Z`);
    const window = { userId, windowStart };

    const [
      sessionSeen,
      tasksCreated,
      agentTotals,
      windowRows,
      recentRows,
      callSeconds,
      droppedCalls,
      memberships,
      installations,
      providerKeys,
      connections,
      defaults,
      failedRuns,
    ] = yield* Effect.all(
      [
        findSessionSeen(userId),
        findTasksCreated(window),
        findAgentTotals(window),
        findAgents({ userId, windowStart, limit: ADMIN_ACCOUNT_STATUS_READ_LIMIT }),
        findAgents({ userId, windowStart: null, limit: ADMIN_RECENT_AGENTS_LIMIT }),
        findCallSeconds({ userId, windowStartMs: windowStart.getTime() }),
        findDroppedCalls(window),
        findMemberships(userId),
        findInstallations(userId),
        findProviderKeys(userId),
        findConnections(userId),
        findDefaults(userId),
        findFailedRuns(window),
      ],
      { concurrency: "unbounded" },
    );

    const agents = yield* withStandings(windowRows, recentRows);

    const githubByWorkspace = new Map<string, (typeof installations)[number]["status"][]>();
    for (const installation of installations) {
      const statuses = githubByWorkspace.get(installation.organizationId) ?? [];
      statuses.push(installation.status);
      githubByWorkspace.set(installation.organizationId, statuses);
    }

    const totals = Option.getOrUndefined(agentTotals);
    const chosen = Option.getOrUndefined(defaults);

    return {
      sessionSeenAt: Option.getOrUndefined(sessionSeen)?.seenAt ?? null,
      totals: {
        tasksCreated: Option.getOrUndefined(tasksCreated)?.value ?? 0,
        agentsStarted: totals?.started ?? 0,
        pullRequestsOpened: totals?.opened ?? 0,
        pullRequestsMerged: totals?.merged ?? 0,
        callSeconds: Option.getOrUndefined(callSeconds)?.seconds ?? 0,
      },
      ...agents,
      workspaces: memberships.map((membership) => ({
        ...membership,
        github: githubByWorkspace.get(membership.id) ?? [],
      })),
      providerKeys: providerKeys.map((key) => ({ ...key, statusAt: key.statusAt.getTime() })),
      connections: connections.map((connection) => ({
        ...connection,
        at: connection.at.getTime(),
      })),
      defaults:
        chosen === undefined
          ? null
          : {
              model: chosen.model,
              effort: chosen.effort,
              contextWindow: chosen.contextWindow,
              experiments: experimentChoicesFrom(chosen.experiments ?? undefined) ?? NO_EXPERIMENTS,
            },
      droppedCalls: droppedCalls.map((call) => ({
        at: call.at,
        reason: VOICE_CLOSE_REASON.CONNECTION_LOST,
      })),
      failedRuns,
    };
  });
}
