import { WORKSPACE_ROLE, type WorkspaceRole } from "@sidecar/hosted/workspace-wire";
import { and, asc, eq, exists, isNull, or, type SQL, type SQLWrapper } from "drizzle-orm";
import { type Cause, DateTime, Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import { member, organization, user } from "../db/auth-schema.js";
import { githubInstallation } from "../db/github-installation-schema.js";
import { GITHUB_INSTALLATION_STATUS } from "../db/github-installation-vocabulary.js";
import { personalWorkspace } from "../db/personal-workspace-schema.js";
import { plan } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import type { StoreFailure } from "./store-failure.js";
import type { WorkspaceCreation, WorkspaceSeams } from "./workspace-seams.js";

/**
 * workspace-store.ts -- the workspaces an account is a member of, and the one that is its own.
 *
 * A workspace is a Better Auth `organization` and its team the `member` rows,
 * read here through Drizzle over the plugin's own tables, since a desktop
 * caller holds an OAuth token and no session the plugin's endpoints would
 * take. The one write is an account's personal workspace, made through the
 * plugin's server-only `createOrganization` (`workspace-seams.ts`) so the
 * organization and its owner are the plugin's own rows, and then named the
 * account's in `personal_workspace`. That write is no transaction: Better
 * Auth writes over its own pool, outside the fiber's `SqlClient`, so two Macs
 * ensuring at once settle on unique keys instead, the workspace's slug and
 * the account's row, and the one that loses adopts what the other made.
 * Whether an account is in a workspace is one condition, its `member` row,
 * which a statement elsewhere joins into its own where clause: a plan is
 * read and written by every member of the workspace it names, so a store
 * gates a plan through `planReachableBy` and `reachablePlan` rather than by
 * the account that started it.
 * Every function is an effect over the ambient `SqlClient`.
 */

/** The slug every personal workspace is made under, one per account, which is what makes the plugin refuse a second. */
const PERSONAL_SLUG_PREFIX = "personal-";

/** The metadata the plugin stores on a personal workspace, as JSON text; only the server writes it. */
const PERSONAL_WORKSPACE_METADATA = { personal: true } as const;

/** One workspace as its members see it: the account's own one is marked personal, and each carries the account's role in it. */
export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly personal: boolean;
  readonly role: WorkspaceRole;
}

const WORKSPACE_ROLES: readonly WorkspaceRole[] = Object.values(WORKSPACE_ROLE);

/** What a workspace read answers: an effect over the ambient client. */
export type WorkspaceStoreEffect<A, E = never> = Effect.Effect<
  A,
  StoreFailure | E,
  SqlClient.SqlClient
>;

const OrganizationIdSchema = Schema.Struct({ organizationId: Schema.String });

const WorkspaceRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** The account's own id where this workspace is its personal one, else null. */
  personalOf: Schema.NullOr(Schema.String),
  /** The plugin's role text, which may list several roles comma-separated. */
  role: Schema.String,
});

const findPersonalWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OrganizationIdSchema,
  execute: (userId) =>
    db
      .select({ organizationId: personalWorkspace.organizationId })
      .from(personalWorkspace)
      .where(eq(personalWorkspace.userId, userId))
      .limit(1),
});

const findAccountName = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ name: Schema.String }),
  execute: (userId) => db.select({ name: user.name }).from(user).where(eq(user.id, userId)),
});

const findOrganizationBySlug = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OrganizationIdSchema,
  execute: (slug) =>
    db
      .select({ organizationId: organization.id })
      .from(organization)
      .where(eq(organization.slug, slug)),
});

const insertPersonalWorkspace = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    organizationId: Schema.String,
    now: Schema.Date,
  }),
  execute: (row) =>
    db
      .insert(personalWorkspace)
      .values({ userId: row.userId, organizationId: row.organizationId, createdAt: row.now })
      .onConflictDoNothing(),
});

/**
 * The condition that the account is a member of the workspace: a literal id,
 * or the column of a row the statement reads, such as a plan's own
 * `organization_id`, so a statement gates on membership in its own where clause.
 */
export function memberOfWorkspace(userId: string, organizationId: string | SQLWrapper): SQL {
  return exists(
    db
      .select({ one: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId))),
  );
}

const findMemberWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, organizationId }) =>
    db
      .select({ id: organization.id })
      .from(organization)
      .where(and(eq(organization.id, organizationId), memberOfWorkspace(userId, organization.id))),
});

const findWorkspaces = SqlSchema.findAll({
  Request: Schema.String,
  Result: WorkspaceRowSchema,
  execute: (userId) =>
    db
      .select({
        id: organization.id,
        name: organization.name,
        personalOf: personalWorkspace.userId,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .leftJoin(
        personalWorkspace,
        and(
          eq(personalWorkspace.organizationId, organization.id),
          eq(personalWorkspace.userId, userId),
        ),
      )
      .leftJoin(githubInstallation, eq(githubInstallation.organizationId, organization.id))
      .where(
        and(
          eq(member.userId, userId),
          // Note that a workspace of no installation is shown, and one of an installation only while it is active.
          or(
            isNull(githubInstallation.status),
            eq(githubInstallation.status, GITHUB_INSTALLATION_STATUS.ACTIVE),
          ),
        ),
      )
      .orderBy(asc(organization.name), asc(organization.id)),
});

/** The highest role the plugin's role text names, read as a member where it names none Luke knows. */
export function roleOf(text: string): WorkspaceRole {
  const named = text.split(",").map((part) => part.trim());
  return WORKSPACE_ROLES.find((role) => named.includes(role)) ?? WORKSPACE_ROLE.MEMBER;
}

/**
 * The workspace the plugin holds under the slug asked for: the one this call
 * just made, with the account as its owner, or, where the plugin refused
 * because the slug was taken, the one a racing call made first. Nothing
 * under the slug means the plugin's refusal was something else, and it is
 * answered as it was.
 */
export function createOrAdoptOrganization(
  creation: WorkspaceCreation,
  seams: WorkspaceSeams,
): WorkspaceStoreEffect<string, Cause.UnknownError> {
  return seams.createOrganization(creation).pipe(
    Effect.map((created) => created.id),
    Effect.catch((refusal) =>
      Effect.flatMap(findOrganizationBySlug(creation.slug), (standing) =>
        Option.match(standing, {
          onNone: () => Effect.fail(refusal),
          onSome: (row) => Effect.succeed(row.organizationId),
        }),
      ),
    ),
  );
}

/** The condition that the account may read and write the plan row a statement reads: it is a member of the plan's workspace. */
export function planReachableBy(userId: string): SQL {
  return memberOfWorkspace(userId, plan.organizationId);
}

/** The plan under this id, where the account is a member of its workspace; any other id reads as no plan. */
export function reachablePlan(userId: string, planId: string): SQL | undefined {
  return and(eq(plan.id, planId), planReachableBy(userId));
}

/** The account's personal workspace, by id; nothing before it was ever ensured. */
export function personalWorkspaceOf(userId: string): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.map(
    findPersonalWorkspace(userId),
    Option.map((row) => row.organizationId),
  );
}

/**
 * The account's personal workspace, made the first time it is asked for:
 * the plugin creates the organization with the account as its owner, and
 * the row naming it the account's is written once, so the second ensure
 * makes nothing. The row is read back rather than taken from the insert,
 * because where two ensures race the row that stands may be the other's.
 * Nothing for an account gone.
 */
export function ensurePersonalWorkspace(
  userId: string,
  seams: WorkspaceSeams,
): WorkspaceStoreEffect<Option.Option<string>, Cause.UnknownError> {
  return Effect.gen(function* () {
    const standing = yield* personalWorkspaceOf(userId);
    if (Option.isSome(standing)) return standing;
    const account = yield* findAccountName(userId);
    if (Option.isNone(account)) return Option.none();
    const organizationId = yield* createOrAdoptOrganization(
      {
        name: account.value.name,
        slug: `${PERSONAL_SLUG_PREFIX}${userId}`,
        userId,
        metadata: PERSONAL_WORKSPACE_METADATA,
      },
      seams,
    );
    const now = yield* DateTime.nowAsDate;
    yield* insertPersonalWorkspace({ userId, organizationId, now });
    return yield* personalWorkspaceOf(userId);
  });
}

/** Whether the account is a member of the workspace; a workspace that names nothing has none. */
export function isWorkspaceMember(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<boolean> {
  return Effect.map(findMemberWorkspace({ userId, organizationId }), Option.isSome);
}

/**
 * Every workspace the account is a member of and may see, its personal one
 * first and the rest by name: a workspace of a GitHub App installation
 * suspended or removed is left out.
 */
export function listWorkspaces(userId: string): WorkspaceStoreEffect<readonly Workspace[]> {
  return Effect.map(findWorkspaces(userId), (rows) => {
    const workspaces = rows.map((row) => ({
      id: row.id,
      name: row.name,
      personal: row.personalOf !== null,
      role: roleOf(row.role),
    }));
    return [
      ...workspaces.filter((workspace) => workspace.personal),
      ...workspaces.filter((workspace) => !workspace.personal),
    ];
  });
}
