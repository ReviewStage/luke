import { Database, queryBuilder } from "@repo/database/core/query";
import {
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@repo/database/github-installation-vocabulary";
import { InstantColumnSchema } from "@repo/database/models/columns";
import { WORKSPACE_NAME } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { invitation, member, organization, user } from "@repo/database/schemas/auth";
import { githubInstallation } from "@repo/database/schemas/github-installation";
import { personalWorkspace } from "@repo/database/schemas/personal-workspace";
import { descriptionRevision } from "@repo/database/schemas/description-revision";
import { task } from "@repo/database/schemas/task";
import {
  ADMIN_METRICS_SCOPE,
  ADMIN_WORKSPACES_KIND,
  type AdminMetricsScope,
  type AdminWorkspacesKind,
} from "@repo/features/admin-wire";
import { roleOf, WORKSPACE_ROLE } from "@repo/features/workspace-wire";
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
import { ACCOUNT_FACE_COLUMNS, ACCOUNT_FACE_FIELDS } from "./admin-queries.js";
import { searchLikePatterns } from "./admin-users.js";
import type { AdminWorkspaceDetailSource } from "./admin-workspace.js";
import {
  ADMIN_WORKSPACES_ACTIVITY_DAYS,
  ADMIN_WORKSPACES_LIMIT,
  type AdminWorkspaceListSource,
} from "./admin-workspaces.js";
import type { AdminSeamEffect } from "./seam.js";

const SHARED_MEMBERS = 2;

const _UserRoleSchema = Schema.NullOr(Schema.Literals(Object.values(USER_ROLE)));

const ScopeSchema = Schema.Literals([ADMIN_METRICS_SCOPE.NON_ADMINS, ADMIN_METRICS_SCOPE.ALL]);

const KindSchema = Schema.Literals([ADMIN_WORKSPACES_KIND.SHARED, ADMIN_WORKSPACES_KIND.ALL]);

const PERSONAL = sql<boolean>`exists(select 1 from ${personalWorkspace} where ${personalWorkspace.organizationId} = ${organization.id})`;

const MEMBER_COUNT = sql<number>`(select count(*)::int from ${member} where ${member.organizationId} = ${organization.id})`;

const SHARED = sql<boolean>`(not ${PERSONAL} and ${MEMBER_COUNT} >= ${SHARED_MEMBERS})`;

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

function tasksSince(since: Date): SQL<number> {
  return sql<number>`(select count(*)::int from ${task} where ${and(eq(task.organizationId, organization.id), gte(task.createdAt, since))})`;
}

function agentsSince(since: Date): SQL<number> {
  return sql<number>`(select count(*)::int from ${agentTable} where ${and(eq(agentTable.organizationId, organization.id), gte(agentTable.createdAt, since))})`;
}

function revisionsSince(since: Date): SQL<number> {
  return sql<number>`(select count(*)::int from ${descriptionRevision} inner join ${task} on ${task.id} = ${descriptionRevision.taskId} where ${and(eq(task.organizationId, organization.id), gte(descriptionRevision.at, since))})`;
}

function prsMergedSince(sinceMs: number): SQL<number> {
  return sql<number>`(select count(distinct ${agentTable.published} ->> 'url')::int from ${agentTable} where ${eq(agentTable.organizationId, organization.id)} and (${agentTable.published} ->> 'mergedAt')::numeric >= ${sinceMs})`;
}

function activeSince(since: Date): SQL<boolean> {
  return sql<boolean>`(${tasksSince(since)} > 0 or ${agentsSince(since)} > 0 or ${revisionsSince(since)} > 0)`;
}

function installedAs(status: GitHubInstallationStatus): SQL<boolean> {
  return sql<boolean>`exists(select 1 from ${githubInstallation} where ${and(eq(githubInstallation.organizationId, organization.id), eq(githubInstallation.status, status))})`;
}

const WorkspaceFilterSchema = Schema.Struct({
  scope: ScopeSchema,
  kind: KindSchema,
  search: Schema.NullOr(Schema.String),
});

type WorkspaceFilter = typeof WorkspaceFilterSchema.Type;

function keptByFilter(filter: WorkspaceFilter): SQL | undefined {
  return and(
    keptByScope(filter.scope),
    filter.kind === ADMIN_WORKSPACES_KIND.ALL ? undefined : SHARED,
    ...(filter.search === null
      ? []
      : searchLikePatterns(filter.search).map((pattern) => ilike(WORKSPACE_NAME, pattern))),
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
    ...ACCOUNT_FACE_FIELDS,
  }),
  execute: (organizationIds) =>
    Database.use((db) =>
      db
        .select({
          organizationId: member.organizationId,
          ...ACCOUNT_FACE_COLUMNS,
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

function readConnections(organizationIds: readonly string[]) {
  if (organizationIds.length === 0) {
    return Effect.succeed([[], []] as const);
  }
  return Effect.all([findOwners(organizationIds), findInstallations(organizationIds)], {
    concurrency: "unbounded",
  });
}

function activitySince(now: number): Date {
  const sinceDay = lastNDayKeys(now, ADMIN_WORKSPACES_ACTIVITY_DAYS)[0];
  return new Date(`${sinceDay}T00:00:00.000Z`);
}

const { revisionsWeek: _revisionsWeek, ...WORKSPACE_DETAIL_FIELDS } = WorkspaceRowSchema.fields;

const findWorkspaceRow = SqlSchema.findOneOption({
  Request: Schema.Struct({ id: Schema.String, ...ActivityWindowSchema.fields }),
  Result: Schema.Struct(WORKSPACE_DETAIL_FIELDS),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          id: organization.id,
          name: sql<string>`${WORKSPACE_NAME}`,
          personal: sql<boolean>`${PERSONAL}`,
          members: sql<number>`${MEMBER_COUNT}`,
          tasksWeek: tasksSince(request.since),
          agentsWeek: agentsSince(request.since),
          prsMergedWeek: prsMergedSince(request.sinceMs),
          createdAt: organization.createdAt,
        })
        .from(organization)
        .where(eq(organization.id, request.id)),
    ),
});

const findMembers = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    ...ACCOUNT_FACE_FIELDS,
    memberRole: Schema.String,
    joinedAt: InstantColumnSchema,
  }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          ...ACCOUNT_FACE_COLUMNS,
          memberRole: member.role,
          joinedAt: member.createdAt,
        })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, organizationId))
        .orderBy(asc(member.createdAt), asc(member.id)),
    ),
});

export function readAdminWorkspaceSource(input: {
  now: number;
  id: string;
}): AdminSeamEffect<AdminWorkspaceDetailSource | undefined> {
  return Effect.gen(function* () {
    const since = activitySince(input.now);
    const [found, members, installations] = yield* Effect.all(
      [
        findWorkspaceRow({ id: input.id, since, sinceMs: since.getTime() }),
        findMembers(input.id),
        findInstallations([input.id]),
      ],
      { concurrency: "unbounded" },
    );
    if (Option.isNone(found)) return undefined;
    const { createdAt, ...row } = found.value;
    const read = members.map(({ memberRole, joinedAt, role, ...account }) => ({
      account: { ...account, admin: isAdminRole(role) },
      role: roleOf(memberRole),
      joinedAt: joinedAt.getTime(),
    }));
    const owning = (each: (typeof read)[number]) => each.role === WORKSPACE_ROLE.OWNER;
    return {
      row: { ...row, createdAt: createdAt.getTime() },
      members: [...read.filter(owning), ...read.filter((each) => !owning(each))],
      installations: installations.map(
        ({ organizationId: _organizationId, ...installation }) => installation,
      ),
    };
  });
}

export function readAdminWorkspacesSource(input: {
  now: number;
  scope: AdminMetricsScope;
  kind: AdminWorkspacesKind;
  search: string | undefined;
}): AdminSeamEffect<AdminWorkspaceListSource> {
  return Effect.gen(function* () {
    const since = activitySince(input.now);
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
    const [owners, installations] = yield* readConnections(rows.map((row) => row.id));

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
      summary: {
        ...totals,
        invitations,
      },
    };
  });
}
