import { createHash, randomUUID } from "node:crypto";
import { pinnedPictureUrl } from "@luke/features/account-picture";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { GITHUB_TOKEN_STATUS } from "@luke/features/github-token-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  RESERVED_WORKSPACE_SLUGS,
  type Workspace as WireWorkspace,
  WORKSPACE_ROLE,
  type WorkspacePhoto,
  type WorkspaceRole,
  workspacePhotoOfDataUrl,
} from "@luke/features/workspace-wire";
import { and, asc, eq, exists, inArray, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { type Cause, DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import {
  Database,
  type DatabaseServices,
  type DatabaseShape,
  type QueryError,
  queryBuilder,
} from "../core/query.js";
import { GITHUB_INSTALLATION_STATUS } from "../github-installation-vocabulary.js";
import { INTEGRATION_ROW_STATUS } from "../integration-vocabulary.js";
import { member, organization, user } from "../schemas/auth.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { githubInstallation } from "../schemas/github-installation.js";
import { githubPersonalToken } from "../schemas/github-personal-token.js";
import { githubRepositoryRead } from "../schemas/github-repository-read.js";
import { personalWorkspace } from "../schemas/personal-workspace.js";
import { task } from "../schemas/task.js";
import { workspaceIntegrationConnection } from "../schemas/workspace-integration.js";
import {
  PERSONAL_WORKSPACE_METADATA,
  type WorkspaceCreation,
  type WorkspaceSeams,
} from "./workspace-seams.js";

/**
 * workspace-store.ts -- the workspaces an account is a member of, and the first one, made for it.
 *
 * A workspace is a Better Auth `organization` and its team the `member` rows,
 * read here through Drizzle over the plugin's own tables, since a desktop
 * caller holds an OAuth token and no session the plugin's endpoints would
 * take. A workspace is made through the plugin's server-only
 * `createOrganization` (`workspace-seams.ts`), so the organization and its
 * owner are the plugin's own rows. The account's first workspace is made the
 * first time it is asked for, under the account's name, its metadata marked
 * personal, and named the account's in `personal_workspace`. That row is
 * how a start or a listing finds the account's default, and how every read
 * names the workspace for its owner as the owner is called now
 * (`WORKSPACE_NAME`) and lists it as personal, so it has no name of its own
 * and is never renamed; nothing reads the mark, and it is otherwise a
 * workspace like any other. That write is no transaction: Better
 * Auth writes over its own pool, outside the fiber's `SqlClient`, so two Macs
 * ensuring at once settle on unique keys instead, the workspace's slug and
 * the account's row, and the one that loses adopts what the other made.
 * Whether an account is in a workspace is one condition, its `member` row,
 * which a statement elsewhere joins into its own where clause: a task is
 * read and written by every member of the workspace it names, so a store
 * gates a task through `taskReachableBy` and `reachableTask` rather than by
 * the account that started it.
 * A task or a coding agent reached on its owner's own GitHub token
 * (`github_access = 'token'`) is narrower: beside its owner, it is seen only
 * by a member whose own verified token GitHub last answered with its
 * repository, as the service wrote that answer in `github_repository_read`;
 * this module asks GitHub nothing.
 * A workspace's photo is the plugin's own `organization.logo`, kept as a
 * `data:` URL of one of `WORKSPACE_PHOTO_TYPE`; a list names only a digest of
 * it, and its bytes are read apart, by a member alone. The account's own
 * first workspace with no photo lists the account's sign-in picture, where
 * the renderer may draw it.
 * Every function is an effect over the ambient `Database`.
 */

/** The slug every account's first workspace is made under, one per account, which is what makes the plugin refuse a second. */
const PERSONAL_SLUG_PREFIX = "personal-";

/** How many hex characters of a photo's digest name its version: enough that two photos of one workspace never share one. */
const PHOTO_VERSION_CHARS = 16;

/**
 * One workspace as its members see it: the account's role in it and the
 * GitHub accounts its connected installations are on, the first linked
 * first.
 */
export type Workspace = WireWorkspace;

const WORKSPACE_ROLES: readonly WorkspaceRole[] = Object.values(WORKSPACE_ROLE);

/** What a workspace read answers: an effect over the ambient database. */
/**
 * A workspace's name as its members read it: an account's first workspace is
 * called by that account's name as it stands now, so a renamed account
 * renames it, and any other by its own. Note that the owner is read by the
 * workspace alone, never the account asking, because a teammate in someone's
 * first workspace reads it under the owner's name too; the workspace's own
 * name is what stands once the account is gone.
 */
export const WORKSPACE_NAME = sql<string>`coalesce((select "owner"."name" from ${personalWorkspace} as "personal" inner join ${user} as "owner" on "owner"."id" = "personal"."user_id" where "personal"."organization_id" = ${organization.id}), ${organization.name})`;

export type WorkspaceStoreEffect<A, E = never> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError | E,
  DatabaseServices
>;

const OrganizationIdSchema = Schema.Struct({ organizationId: Schema.String });

const WorkspaceRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  /** The account's own id where this workspace is the first one made for it, else null. */
  personalOf: Schema.NullOr(Schema.String),
  /** Whether this workspace is the first one made for any account, the asking one or another. */
  personal: Schema.Boolean,
  /** The plugin's role text, which may list several roles comma-separated. */
  role: Schema.String,
  /** The status of the workspace's Linear row, or null where it holds none. */
  linearStatus: Schema.NullOr(Schema.String),
  /** How many members the workspace has, the account among them. */
  memberCount: Schema.Number,
  /** The plugin's `logo` text, which holds the workspace's photo as a `data:` URL where it has one. */
  logo: Schema.NullOr(Schema.String),
  /** The account's own sign-in picture where this workspace is the first one made for it, else null. */
  ownerImage: Schema.NullOr(Schema.String),
});

const InstallationRowSchema = Schema.Struct({
  organizationId: Schema.String,
  installationId: Schema.Number,
  /** The login of the GitHub account the installation is on. */
  login: Schema.String,
  /** The installation's status as its webhook, or a read of GitHub, last wrote it. */
  status: Schema.String,
});

type InstallationRow = typeof InstallationRowSchema.Type;

const findPersonalWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OrganizationIdSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ organizationId: personalWorkspace.organizationId })
        .from(personalWorkspace)
        .where(eq(personalWorkspace.userId, userId))
        .limit(1),
    ),
});

const findAccountName = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ name: Schema.String }),
  execute: (userId) =>
    Database.use((db) => db.select({ name: user.name }).from(user).where(eq(user.id, userId))),
});

const findAccountNames = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: Schema.Struct({ id: Schema.String, name: Schema.String }),
  execute: (ids) =>
    Database.use((db) =>
      db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, [...ids])),
    ),
});

const findOrganizationBySlug = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OrganizationIdSchema,
  execute: (slug) =>
    Database.use((db) =>
      db
        .select({ organizationId: organization.id })
        .from(organization)
        .where(eq(organization.slug, slug)),
    ),
});

const findOwnedOrganization = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: OrganizationIdSchema,
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(
          and(
            eq(member.userId, userId),
            eq(member.organizationId, organizationId),
            eq(member.role, WORKSPACE_ROLE.OWNER),
          ),
        )
        .limit(1),
    ),
});

const insertPersonalWorkspace = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    organizationId: Schema.String,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(personalWorkspace)
        .values({ userId: row.userId, organizationId: row.organizationId, createdAt: row.now })
        .onConflictDoNothing(),
    ),
});

/**
 * The condition that the account is a member of the workspace: a literal id,
 * or the column of a row the statement reads, such as a task's own
 * `organization_id`, so a statement gates on membership in its own where clause.
 */
function memberOfWorkspace(userId: string, organizationId: string | SQLWrapper): SQL {
  return exists(
    queryBuilder
      .select({ one: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId))),
  );
}

const findMemberWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: organization.id })
        .from(organization)
        .where(
          and(eq(organization.id, organizationId), memberOfWorkspace(userId, organization.id)),
        ),
    ),
});

const findWorkspaceLogo = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ logo: Schema.NullOr(Schema.String) }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ logo: organization.logo })
        .from(organization)
        .where(
          and(eq(organization.id, organizationId), memberOfWorkspace(userId, organization.id)),
        ),
    ),
});

/** The workspaces the account is a member of, or the one named among them, as rows, each with how many members it has, counted apart from the account's own row the read joins. */
function workspaceRows(db: DatabaseShape, userId: string, organizationId?: string) {
  return db
    .select({
      id: organization.id,
      name: WORKSPACE_NAME,
      slug: organization.slug,
      personalOf: personalWorkspace.userId,
      personal: sql<boolean>`exists(select 1 from ${personalWorkspace} as "first" where "first"."organization_id" = ${organization.id})`,
      role: member.role,
      linearStatus: workspaceIntegrationConnection.status,
      memberCount: sql<number>`(select count(*)::int from ${member} as "members" where "members"."organization_id" = ${organization.id})`,
      logo: organization.logo,
      ownerImage: user.image,
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
    .leftJoin(user, eq(user.id, personalWorkspace.userId))
    .leftJoin(
      workspaceIntegrationConnection,
      and(
        eq(workspaceIntegrationConnection.organizationId, organization.id),
        eq(workspaceIntegrationConnection.provider, INTEGRATION_PROVIDER.LINEAR),
      ),
    )
    .where(
      and(
        eq(member.userId, userId),
        organizationId === undefined ? undefined : eq(organization.id, organizationId),
      ),
    )
    .orderBy(asc(WORKSPACE_NAME), asc(organization.id));
}

/**
 * The installations connected to the workspaces the account is a member of,
 * or to the one named among them, each workspace's first linked first. A
 * read of its own rather than a join on the workspaces', because a
 * workspace holding several would otherwise be listed once for each.
 */
function installationRows(db: DatabaseShape, userId: string, organizationId?: string) {
  return db
    .select({
      organizationId: githubInstallation.organizationId,
      installationId: githubInstallation.installationId,
      login: githubInstallation.accountLogin,
      status: githubInstallation.status,
    })
    .from(githubInstallation)
    .innerJoin(member, eq(member.organizationId, githubInstallation.organizationId))
    .where(
      and(
        eq(member.userId, userId),
        organizationId === undefined
          ? undefined
          : eq(githubInstallation.organizationId, organizationId),
      ),
    )
    .orderBy(asc(githubInstallation.createdAt), asc(githubInstallation.installationId));
}

const findAllInstallations = SqlSchema.findAll({
  Request: Schema.String,
  Result: InstallationRowSchema,
  execute: (userId) => Database.use((db) => installationRows(db, userId)),
});

const findInstallations = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: InstallationRowSchema,
  execute: ({ userId, organizationId }) =>
    Database.use((db) => installationRows(db, userId, organizationId)),
});

/** The installation rows by the workspace they stand for, each list in the order read. */
function installationsByWorkspace(
  rows: readonly InstallationRow[],
): ReadonlyMap<string, readonly InstallationRow[]> {
  const grouped = new Map<string, InstallationRow[]>();
  for (const row of rows) {
    const listed = grouped.get(row.organizationId);
    if (listed === undefined) grouped.set(row.organizationId, [row]);
    else listed.push(row);
  }
  return grouped;
}

const findWorkspaces = SqlSchema.findAll({
  Request: Schema.String,
  Result: WorkspaceRowSchema,
  execute: (userId) => Database.use((db) => workspaceRows(db, userId)),
});

const findWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: WorkspaceRowSchema,
  execute: ({ userId, organizationId }) =>
    Database.use((db) => workspaceRows(db, userId, organizationId)),
});

/** The photo a workspace's `logo` holds, where it is a `data:` URL of a photo's type whose bytes read; nothing for any other text. */
function photoOfLogo(logo: string | null): WorkspacePhoto | undefined {
  return logo === null ? undefined : workspacePhotoOfDataUrl(logo);
}

/**
 * What a row shows of the workspace's face: a digest of its photo where it
 * holds one, else, on the account's own first workspace, the account's
 * sign-in picture where the renderer may draw it, else nothing.
 */
function faceOfRow(
  row: typeof WorkspaceRowSchema.Type,
): Pick<Workspace, "photoVersion" | "pictureUrl"> {
  if (row.logo !== null && photoOfLogo(row.logo) !== undefined) {
    const digest = createHash("sha256").update(row.logo).digest("hex");
    return { photoVersion: digest.slice(0, PHOTO_VERSION_CHARS) };
  }
  const pictureUrl = row.personalOf === null ? undefined : pinnedPictureUrl(row.ownerImage);
  return pictureUrl === undefined ? {} : { pictureUrl };
}

/**
 * The workspace's Linear as the wire carries it: active while its row
 * stands connected, inactive once Connect refused the grant, and absent for
 * no row or a first sign-in still under way.
 */
function linearOfRow(status: string | null): Pick<Workspace, "linear"> {
  if (status === INTEGRATION_ROW_STATUS.CONNECTED) return { linear: { active: true } };
  if (status === INTEGRATION_ROW_STATUS.EXPIRED) return { linear: { active: false } };
  return {};
}

/**
 * One row as the wire carries the workspace, with its installations: every
 * one, and again the first linked that is still active, else the first
 * linked, as the one a desktop from before several reads.
 */
function workspaceOfRow(
  row: typeof WorkspaceRowSchema.Type,
  installations: readonly InstallationRow[],
): Workspace {
  const githubInstallations = installations.map((installation) => ({
    installationId: installation.installationId,
    login: installation.login,
    active: installation.status === GITHUB_INSTALLATION_STATUS.ACTIVE,
  }));
  // Note that a desktop from before several reads one account alone, so it reads the first one
  // still active, because the first linked may have lapsed while another runs.
  const first = githubInstallations.find((one) => one.active) ?? githubInstallations[0];
  const workspace: Workspace = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: roleOf(row.role),
    github: first === undefined ? null : { login: first.login, active: first.active },
    githubInstallations,
    ...linearOfRow(row.linearStatus),
    memberCount: row.memberCount,
    ...faceOfRow(row),
  };
  return row.personal ? { ...workspace, personal: true } : workspace;
}

/** The longest slug spelled from a workspace's name, before any suffix. */
const MAX_SLUG_CHARS = 48;

/** A workspace's slug spelled from its name: lowercase letters and digits, a hyphen between runs of them, "workspace" where the name has none, and never one an account's first workspace is made under or one Luke's own pages stand under. */
function slugOf(name: string): string {
  const spelled = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/u, "");
  if (spelled === "") return "workspace";
  // Note that no workspace a member names takes the slug an account's first one is made under, so an ensure finds its own there, nor a step of Luke's own paths.
  const own = spelled.startsWith(PERSONAL_SLUG_PREFIX) || RESERVED_WORKSPACE_SLUGS.has(spelled);
  return own ? `workspace-${spelled}` : spelled;
}

/** The highest role the plugin's role text names, read as a member where it names none Luke knows. */
export function roleOf(text: string): WorkspaceRole {
  const named = text.split(",").map((part) => part.trim());
  return WORKSPACE_ROLES.find((role) => named.includes(role)) ?? WORKSPACE_ROLE.MEMBER;
}

/** Whether an organization already stands for what a workspace is being made for, as the caller reads it. */
type OrganizationLinked = (organizationId: string) => WorkspaceStoreEffect<boolean>;

/** The slug an account's first workspace is made under. */
function personalSlugOf(userId: string): string {
  return `${PERSONAL_SLUG_PREFIX}${userId}`;
}

/**
 * A workspace made under the first of the slugs the plugin takes, with the
 * account as its owner. A slug the plugin refuses as taken is adopted only
 * where the organization under it is already linked to what the workspace
 * stands for, which is a racing call having made it first; an organization
 * anyone else made under the slug is never adopted, and the next slug is
 * tried. Nothing under the slug means the plugin refused for another
 * reason, and that refusal, or the last slug's, is answered as it was.
 */
function createLinkedOrganization(
  creation: Omit<WorkspaceCreation, "slug">,
  slugs: readonly [string, ...string[]],
  linked: OrganizationLinked,
  seams: WorkspaceSeams,
): WorkspaceStoreEffect<string, Cause.UnknownError> {
  const [slug, ...rest] = slugs;
  return seams.createOrganization({ ...creation, slug }).pipe(
    Effect.map((created) => created.id),
    Effect.catch((refusal) =>
      Effect.flatMap(findOrganizationBySlug(slug), (standing) => {
        if (Option.isNone(standing)) return Effect.fail(refusal);
        const { organizationId } = standing.value;
        return Effect.flatMap(linked(organizationId), (adopted) => {
          if (adopted) return Effect.succeed(organizationId);
          const [next, ...after] = rest;
          if (next === undefined) return Effect.fail(refusal);
          return createLinkedOrganization(creation, [next, ...after], linked, seams);
        });
      }),
    ),
  );
}

/**
 * Whether the organization under the account's first workspace's slug is
 * its own: the account is its owner member, which a racing ensure makes it
 * before it writes the row naming it the account's, and which no one else's
 * organization makes it.
 */
function isOwnPersonalOrganization(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<boolean> {
  return Effect.map(findOwnedOrganization({ userId, organizationId }), Option.isSome);
}

/** The condition that the account is a member of the workspace a statement names, by its id or a column standing for it. */
export function workspaceReachableBy(userId: string, organizationId: string | SQLWrapper): SQL {
  return memberOfWorkspace(userId, organizationId);
}

/** A coding agent row's workspace: its own, or its task's on a row the backfill has not reached yet. */
export const AGENT_WORKSPACE = sql<string>`coalesce(${codingAgent.organizationId}, (select ${task.organizationId} from ${task} where ${task.id} = ${codingAgent.taskId}))`;

/** How a task or an agent row was reached on GitHub, whose it is, and its repository, as `seenThroughGitHub` reads them. */
interface GitHubReachedColumns {
  readonly access: SQLWrapper;
  readonly owner: SQLWrapper;
  readonly repository: SQLWrapper;
}

/**
 * The condition that the account sees a row as the way it reached GitHub
 * allows: one reached through the workspace's App by every member, and one
 * reached on its owner's own token by that owner and by any other member
 * whose own token stands verified and was last answered with the row's
 * repository.
 */
function seenThroughGitHub(userId: string, row: GitHubReachedColumns): SQL {
  const readsRepository = exists(
    queryBuilder
      .select({ one: githubRepositoryRead.userId })
      .from(githubRepositoryRead)
      .innerJoin(githubPersonalToken, eq(githubPersonalToken.userId, githubRepositoryRead.userId))
      .where(
        and(
          eq(githubRepositoryRead.userId, userId),
          eq(githubRepositoryRead.repository, sql`lower(${row.repository})`),
          eq(githubRepositoryRead.readable, true),
          eq(githubPersonalToken.status, GITHUB_TOKEN_STATUS.VERIFIED),
        ),
      ),
  );
  return sql`(${eq(row.access, GITHUB_ACCESS.APP)} or ${eq(row.owner, userId)} or ${readsRepository})`;
}

/** The condition that the account sees the coding agent row as its GitHub access allows (`seenThroughGitHub`), for a statement that gates its workspace already. */
export function agentSeenBy(userId: string): SQL {
  return seenThroughGitHub(userId, {
    access: codingAgent.githubAccess,
    owner: codingAgent.userId,
    repository: codingAgent.repository,
  });
}

/** The condition that the account may read and write the coding agent row a statement reads: it is a member of the agent's workspace, an agent with no task as much as one on a task, and sees it as its GitHub access allows. */
export function agentReachableBy(userId: string): SQL {
  return sql`(${memberOfWorkspace(userId, AGENT_WORKSPACE)} and ${agentSeenBy(userId)})`;
}

/** The condition that the account may read and write the task row a statement reads: it is a member of the task's workspace, and sees it as its GitHub access allows. */
export function taskReachableBy(userId: string): SQL {
  const seen = seenThroughGitHub(userId, {
    access: task.githubAccess,
    owner: task.userId,
    repository: task.repository,
  });
  return sql`(${memberOfWorkspace(userId, task.organizationId)} and ${seen})`;
}

/** The task under this id, where the account is a member of its workspace; any other id reads as no task. */
export function reachableTask(userId: string, taskId: string): SQL | undefined {
  return and(eq(task.id, taskId), taskReachableBy(userId));
}

/** The account's first workspace, by id; nothing before it was ever ensured. */
export function personalWorkspaceOf(userId: string): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.map(
    findPersonalWorkspace(userId),
    Option.map((row) => row.organizationId),
  );
}

/**
 * The account's first workspace, made the first time it is asked for:
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
    const slug = personalSlugOf(userId);
    const organizationId = yield* createLinkedOrganization(
      { name: account.value.name, userId, metadata: PERSONAL_WORKSPACE_METADATA },
      // Note that the second slug is one nobody can know beforehand, for a first taken by someone else.
      [slug, `${slug}-${randomUUID()}`],
      (candidate) => isOwnPersonalOrganization(userId, candidate),
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
 * Every workspace the account is a member of, its first one first and the
 * rest by name, each once however many installations it holds. An
 * installation suspended or removed is listed inactive rather than left
 * out, so its workspace's tasks stay reachable; GitHub refuses its
 * repository work on its own.
 */
export function listWorkspaces(userId: string): WorkspaceStoreEffect<readonly Workspace[]> {
  return Effect.gen(function* () {
    const rows = yield* findWorkspaces(userId);
    const installations = installationsByWorkspace(yield* findAllInstallations(userId));
    return [
      ...rows.filter((row) => row.personalOf !== null),
      ...rows.filter((row) => row.personalOf === null),
    ].map((row) => workspaceOfRow(row, installations.get(row.id) ?? []));
  });
}

/** One workspace the account is a member of, as its list carries it; nothing for one it is not in. */
export function workspaceOf(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<Option.Option<Workspace>> {
  return Effect.gen(function* () {
    const row = yield* findWorkspace({ userId, organizationId });
    if (Option.isNone(row)) return Option.none();
    const installations = yield* findInstallations({ userId, organizationId });
    return Option.some(workspaceOfRow(row.value, installations));
  });
}

/** One workspace's photo as its bytes, to a member of it alone; nothing for a workspace it is not in, or one that holds no photo. */
export function readWorkspacePhoto(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<Option.Option<WorkspacePhoto>> {
  return Effect.map(findWorkspaceLogo({ userId, organizationId }), (found) =>
    Option.flatMap(found, (row) => Option.fromNullishOr(photoOfLogo(row.logo))),
  );
}

/**
 * A workspace created with the name given, the account its owner, through
 * the plugin's server-only create; its slug is spelled from the name, and a
 * slug the plugin refuses as taken is never adopted: the workspace takes the
 * same slug with a suffix nobody can know beforehand.
 */
export function createWorkspace(
  userId: string,
  name: string,
  seams: WorkspaceSeams,
): WorkspaceStoreEffect<string, Cause.UnknownError> {
  const slug = slugOf(name);
  return createLinkedOrganization(
    { name, userId, metadata: {} },
    [slug, `${slug}-${randomUUID().slice(0, 8)}`],
    () => Effect.succeed(false),
    seams,
  );
}

/**
 * The name each account named holds now, by its id, for the window to say
 * who did a piece of work: a member who has since left a workspace is still
 * named, and an account that is gone is left out.
 */
export function readAccountNames(
  ids: readonly string[],
): WorkspaceStoreEffect<ReadonlyMap<string, string>> {
  const asked = [...new Set(ids)];
  if (asked.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findAccountNames(asked),
    (rows) => new Map(rows.map((row) => [row.id, row.name])),
  );
}
