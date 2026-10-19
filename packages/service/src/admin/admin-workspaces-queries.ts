/**
 * admin-workspaces-queries.ts -- the reads behind the Workspaces tab, over
 * the organization plugin's tables and the rows a workspace's work leaves.
 *
 * Every read here keys on `organization`, so the scope, the kind, and the
 * search are each one condition over its row, and each per-workspace count
 * is a correlated subquery on an index the workspace's own reads already use
 * (`member_organizationId_idx`, `task_organization_created`,
 * `coding_agent_org_created`). Nothing here selects a task's name, a plan's
 * text, a prompt, or a title: only names of workspaces and accounts,
 * statuses, logins, and counts.
 */

import { Database, queryBuilder } from "@luke/database/core/query";
import {
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@luke/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import { InstantColumnSchema } from "@luke/database/models/columns";
import { WORKSPACE_NAME } from "@luke/database/models/workspace-store";
import { invitation, member, organization, user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { personalWorkspace } from "@luke/database/schemas/personal-workspace";
import { planRevision } from "@luke/database/schemas/plan-revision";
import { task } from "@luke/database/schemas/task";
import { workspaceIntegrationConnection } from "@luke/database/schemas/workspace-integration";
import { INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { isAdminRole, USER_ROLE } from "./admin-access.js";
import { lastNDayKeys } from "./admin-metrics.js";
import { searchLikePattern } from "./admin-users.js";
import {
  ADMIN_WORKSPACES_ACTIVITY_DAYS,
  ADMIN_WORKSPACES_LIMIT,
  type AdminWorkspaceListSource,
} from "./admin-workspaces.js";
import {
  ADMIN_METRICS_SCOPE,
  ADMIN_WORKSPACES_KIND,
  type AdminMetricsScope,
  type AdminWorkspacesKind,
} from "./http.js";
import type { AdminSeamEffect } from "./seam.js";

/** The fewest members a workspace has to count as shared. */
const SHARED_MEMBERS = 2;

const UserRoleSchema = Schema.NullOr(Schema.Literals(Object.values(USER_ROLE)));

const ScopeSchema = Schema.Literals([ADMIN_METRICS_SCOPE.NON_ADMINS, ADMIN_METRICS_SCOPE.ALL]);

const KindSchema = Schema.Literals([ADMIN_WORKSPACES_KIND.SHARED, ADMIN_WORKSPACES_KIND.ALL]);

/** Whether the workspace is the personal one made for some account. */
const PERSONAL = sql<boolean>`exists(select 1 from ${personalWorkspace} where ${personalWorkspace.organizationId} = ${organization.id})`;

const MEMBER_COUNT = sql<number>`(select count(*)::int from ${member} where ${member.organizationId} = ${organization.id})`;

/** Two or more members and nobody's personal workspace: a team using Luke together. */
const SHARED = sql<boolean>`(not ${PERSONAL} and ${MEMBER_COUNT} >= ${SHARED_MEMBERS})`;

/**
 * The workspaces a scope keeps. Admin accounts are the maintainers' own, so
 * the default keeps a workspace only while one member of it is not an admin
 * (a null role is an ordinary account's, as the other reads take it): a
 * maintainer's personal workspace and one only maintainers share drop out,
 * and a customer's workspace a maintainer joined stays.
 */
function keptByScope(scope: AdminMetricsScope): SQL | undefined {
  if (scope === ADMIN_METRICS_SCOPE.ALL) return undefined;
  return exists(
    queryBuilder
      .select({ one: member.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(
        and(
          eq(member.organizationId, organization.id),
          or(ne(user.role, USER_ROLE.ADMIN), isNull(user.role)),
        ),
      ),
  );
}

/** The workspace's tasks started since the instant. */
function tasksSince(since: Date): SQL<number> {
  return sql<number>`(select count(*)::int from ${task} where ${and(eq(task.organizationId, organization.id), gte(task.createdAt, since))})`;
}

/** The workspace's coding agents started since the instant. */
function agentsSince(since: Date): SQL<number> {
  return sql<number>`(select count(*)::int from ${codingAgent} where ${and(eq(codingAgent.organizationId, organization.id), gte(codingAgent.createdAt, since))})`;
}

/** Revisions written on the workspace's plans since the instant, by a member, Luke, or an agent alike. */
function revisionsSince(since: Date): SQL<number> {
  return sql<number>`(select count(*)::int from ${planRevision} inner join ${task} on ${task.id} = ${planRevision.taskId} where ${and(eq(task.organizationId, organization.id), gte(planRevision.at, since))})`;
}

/**
 * Pull requests from the workspace's agents that merged since the instant,
 * by their address: an agent continued from another publishes the same pull
 * request, which counts once.
 */
function prsMergedSince(sinceMs: number): SQL<number> {
  return sql<number>`(select count(distinct ${codingAgent.published} ->> 'url')::int from ${codingAgent} where ${eq(codingAgent.organizationId, organization.id)} and (${codingAgent.published} ->> 'mergedAt')::numeric >= ${sinceMs})`;
}

/** Whether the workspace saw a task, an agent, or a plan revision since the instant. */
function activeSince(since: Date): SQL<boolean> {
  return sql<boolean>`(${tasksSince(since)} > 0 or ${agentsSince(since)} > 0 or ${revisionsSince(since)} > 0)`;
}

/** Whether the workspace holds an installation standing at the status. */
function installedAs(status: GitHubInstallationStatus): SQL<boolean> {
  return sql<boolean>`exists(select 1 from ${githubInstallation} where ${and(eq(githubInstallation.organizationId, organization.id), eq(githubInstallation.status, status))})`;
}

const WorkspaceFilterSchema = Schema.Struct({
  scope: ScopeSchema,
  kind: KindSchema,
  search: Schema.NullOr(Schema.String),
});

type WorkspaceFilter = typeof WorkspaceFilterSchema.Type;

/** The scope, the kind, and the search as one condition, which is the whole table filter. */
function keptByFilter(filter: WorkspaceFilter): SQL | undefined {
  return and(
    keptByScope(filter.scope),
    filter.kind === ADMIN_WORKSPACES_KIND.ALL ? undefined : SHARED,
    filter.search === null ? undefined : ilike(WORKSPACE_NAME, searchLikePattern(filter.search)),
  );
}

const CountRowSchema = Schema.Struct({ value: Schema.Number });

const findWorkspaceTotal = SqlSchema.findOneOption({
  Request: WorkspaceFilterSchema,
  Result: CountRowSchema,
  execute: (filter) =>
    Database.use((db) =>
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(organization)
        .where(keptByFilter(filter)),
    ),
});

const WorkspaceRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  personal: Schema.Boolean,
  members: Schema.Number,
  tasksWeek: Schema.Number,
  agentsWeek: Schema.Number,
  revisionsWeek: Schema.Number,
  prsMergedWeek: Schema.Number,
  createdAt: InstantColumnSchema,
});

const ActivityWindowSchema = Schema.Struct({ since: Schema.Date, sinceMs: Schema.Number });

/**
 * The listed workspaces, busiest week first: tasks, agents, and plan
 * revisions summed, so a workspace that only planned this week still ranks
 * above one that did nothing; merged pull requests break the ties, then the
 * youngest workspace, then the id, so equal rows keep one order across
 * refreshes. The counts are read once in a subquery the ordering reads
 * back, rather than spelled again in the ordering.
 */
const findWorkspaceRows = SqlSchema.findAll({
  Request: Schema.Struct({ ...WorkspaceFilterSchema.fields, ...ActivityWindowSchema.fields }),
  Result: WorkspaceRowSchema,
  execute: (request) =>
    Database.use((db) => {
      const listed = db
        .select({
          id: organization.id,
          name: sql<string>`${WORKSPACE_NAME}`.as("name"),
          personal: sql<boolean>`${PERSONAL}`.as("personal"),
          members: sql<number>`${MEMBER_COUNT}`.as("members"),
          tasksWeek: tasksSince(request.since).as("tasks_week"),
          agentsWeek: agentsSince(request.since).as("agents_week"),
          revisionsWeek: revisionsSince(request.since).as("revisions_week"),
          prsMergedWeek: prsMergedSince(request.sinceMs).as("prs_merged_week"),
          createdAt: organization.createdAt,
        })
        .from(organization)
        .where(keptByFilter(request))
        .as("listed");
      return db
        .select()
        .from(listed)
        .orderBy(
          desc(sql`${listed.tasksWeek} + ${listed.agentsWeek} + ${listed.revisionsWeek}`),
          desc(listed.prsMergedWeek),
          desc(listed.createdAt),
          asc(listed.id),
        )
        .limit(ADMIN_WORKSPACES_LIMIT);
    }),
});

const OrganizationIdsSchema = Schema.Array(Schema.String);

const findOwners = SqlSchema.findAll({
  Request: OrganizationIdsSchema,
  Result: Schema.Struct({
    organizationId: Schema.String,
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: Schema.NullOr(Schema.String),
    role: UserRoleSchema,
  }),
  execute: (organizationIds) =>
    Database.use((db) =>
      db
        .select({
          organizationId: member.organizationId,
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(
          and(
            inArray(member.organizationId, [...organizationIds]),
            eq(member.role, WORKSPACE_ROLE.OWNER),
          ),
        )
        .orderBy(asc(member.createdAt), asc(member.id)),
    ),
});

const findInstallations = SqlSchema.findAll({
  Request: OrganizationIdsSchema,
  Result: Schema.Struct({
    organizationId: Schema.String,
    login: Schema.String,
    status: Schema.Literals(Object.values(GITHUB_INSTALLATION_STATUS)),
  }),
  execute: (organizationIds) =>
    Database.use((db) =>
      db
        .select({
          organizationId: githubInstallation.organizationId,
          login: githubInstallation.accountLogin,
          status: githubInstallation.status,
        })
        .from(githubInstallation)
        .where(inArray(githubInstallation.organizationId, [...organizationIds]))
        .orderBy(asc(githubInstallation.createdAt), asc(githubInstallation.installationId)),
    ),
});

/** The statuses a workspace's integration row is shown under; a sign-in still under way is no connection yet. */
const SHOWN_INTEGRATION_STATUSES = [
  INTEGRATION_ROW_STATUS.CONNECTED,
  INTEGRATION_ROW_STATUS.EXPIRED,
] as const;

const findIntegrations = SqlSchema.findAll({
  Request: OrganizationIdsSchema,
  Result: Schema.Struct({
    organizationId: Schema.String,
    provider: Schema.Literals(INTEGRATION_PROVIDER_LIST),
    status: Schema.Literals(SHOWN_INTEGRATION_STATUSES),
  }),
  execute: (organizationIds) =>
    Database.use((db) =>
      db
        .select({
          organizationId: workspaceIntegrationConnection.organizationId,
          provider: workspaceIntegrationConnection.provider,
          status: workspaceIntegrationConnection.status,
        })
        .from(workspaceIntegrationConnection)
        .where(
          and(
            inArray(workspaceIntegrationConnection.organizationId, [...organizationIds]),
            inArray(workspaceIntegrationConnection.provider, [...INTEGRATION_PROVIDER_LIST]),
            inArray(workspaceIntegrationConnection.status, [...SHOWN_INTEGRATION_STATUSES]),
          ),
        )
        .orderBy(asc(workspaceIntegrationConnection.provider)),
    ),
});

const findSharedSummary = SqlSchema.findOneOption({
  Request: Schema.Struct({ scope: ScopeSchema, since: Schema.Date }),
  Result: Schema.Struct({
    shared: Schema.Number,
    sharedActiveWeek: Schema.Number,
    sharedWithActive: Schema.Number,
    sharedWithSuspended: Schema.Number,
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          shared: sql<number>`count(*)::int`,
          sharedActiveWeek: sql<number>`(count(*) filter (where ${activeSince(request.since)}))::int`,
          sharedWithActive: sql<number>`(count(*) filter (where ${installedAs(GITHUB_INSTALLATION_STATUS.ACTIVE)}))::int`,
          sharedWithSuspended: sql<number>`(count(*) filter (where ${installedAs(GITHUB_INSTALLATION_STATUS.SUSPENDED)}))::int`,
        })
        .from(organization)
        .where(and(SHARED, keptByScope(request.scope))),
    ),
});

/**
 * Every invitation into a workspace the scope keeps, counted by status with
 * how many of each are past their expiry. Note that these are not cut to
 * shared workspaces, because an invitation is how a workspace becomes one:
 * an accepted invitation makes its workspace shared while a pending or
 * expired one leaves it solo, so cutting to shared would keep the accepted
 * and drop the rest, and the rate would read near one whatever happened. The expiry is a count filter
 * rather than a grouping, because a grouped expression carrying a bound
 * instant is a different parameter in the select list than in the grouping,
 * which Postgres will not match.
 */
const findInvitationCounts = SqlSchema.findAll({
  Request: Schema.Struct({ scope: ScopeSchema, now: Schema.Date }),
  Result: Schema.Struct({
    status: Schema.String,
    count: Schema.Number,
    pastExpiry: Schema.Number,
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          status: invitation.status,
          count: sql<number>`count(*)::int`,
          pastExpiry: sql<number>`(count(*) filter (where ${lt(invitation.expiresAt, request.now)}))::int`,
        })
        .from(invitation)
        .innerJoin(organization, eq(organization.id, invitation.organizationId))
        .where(keptByScope(request.scope))
        .groupBy(invitation.status),
    ),
});

/** The per-workspace reads for the listed rows, or nothing to ask when no row was listed. */
function readConnections(organizationIds: readonly string[]) {
  if (organizationIds.length === 0) {
    return Effect.succeed([[], [], []] as const);
  }
  return Effect.all(
    [
      findOwners(organizationIds),
      findInstallations(organizationIds),
      findIntegrations(organizationIds),
    ],
    { concurrency: "unbounded" },
  );
}

/**
 * Reads the Workspaces tab: the headline counts over the shared workspaces
 * the scope keeps, whatever the kind and the search say, and the table's
 * rows under all three, cut at the bound while `total` counts every
 * workspace they keep. Each listed workspace's owners, installations, and
 * integrations ride reads of their own keyed on the listed ids, because a
 * join would fan the row's counts out across them.
 */
export function readAdminWorkspacesSource(input: {
  now: number;
  scope: AdminMetricsScope;
  kind: AdminWorkspacesKind;
  search: string | undefined;
}): AdminSeamEffect<AdminWorkspaceListSource> {
  return Effect.gen(function* () {
    const sinceDay = lastNDayKeys(input.now, ADMIN_WORKSPACES_ACTIVITY_DAYS)[0];
    const since = new Date(`${sinceDay}T00:00:00.000Z`);
    const filter = { scope: input.scope, kind: input.kind, search: input.search ?? null };

    const [total, rows, summary, invitations] = yield* Effect.all(
      [
        findWorkspaceTotal(filter),
        findWorkspaceRows({ ...filter, since, sinceMs: since.getTime() }),
        findSharedSummary({ scope: input.scope, since }),
        findInvitationCounts({ scope: input.scope, now: new Date(input.now) }),
      ],
      { concurrency: "unbounded" },
    );
    const [owners, installations, integrations] = yield* readConnections(rows.map((row) => row.id));

    const totals = Option.getOrElse(summary, () => ({
      shared: 0,
      sharedActiveWeek: 0,
      sharedWithActive: 0,
      sharedWithSuspended: 0,
    }));

    return {
      total: Option.match(total, { onNone: () => 0, onSome: (row) => row.value }),
      rows: rows.map(({ revisionsWeek: _revisionsWeek, createdAt, ...row }) => ({
        ...row,
        createdAt: createdAt.getTime(),
      })),
      owners: owners.map(({ organizationId, role, ...owner }) => ({
        organizationId,
        owner: { ...owner, admin: isAdminRole(role) },
      })),
      installations: installations.map(({ organizationId, ...installation }) => ({
        organizationId,
        installation,
      })),
      integrations: integrations.map(({ organizationId, ...integration }) => ({
        organizationId,
        integration,
      })),
      summary: {
        ...totals,
        invitations,
      },
    };
  });
}
