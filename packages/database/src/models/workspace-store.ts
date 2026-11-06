import { createHash, randomUUID } from "node:crypto";
import { pinnedPictureUrl } from "@repo/features/account-picture";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { GITHUB_TOKEN_STATUS } from "@repo/features/github-token-wire";
import {
  formerSlugsOf,
  PERSONAL_WORKSPACE_SLUG_PREFIX,
  RESERVED_WORKSPACE_SLUGS,
  roleOf,
  type Workspace as WireWorkspace,
  WORKSPACE_BOUNDS,
  WORKSPACE_PHOTO_TYPE,
  WORKSPACE_ROLE,
  type WorkspacePhoto,
  type WorkspaceRole,
  workspacePhotoOfDataUrl,
} from "@repo/features/workspace-wire";
import { and, asc, eq, exists, inArray, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { type Cause, DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import {
  Database,
  type DatabaseServices,
  type DatabaseShape,
  type QueryError,
  queryBuilder,
} from "../core/query.js";
import { GITHUB_INSTALLATION_STATUS } from "../github-installation-vocabulary.js";
import { agentTable } from "../schemas/agent.js";
import { member, organization, user } from "../schemas/auth.js";
import { githubInstallation } from "../schemas/github-installation.js";
import { githubPersonalToken } from "../schemas/github-personal-token.js";
import { githubRepositoryRead } from "../schemas/github-repository-read.js";
import { personalWorkspace } from "../schemas/personal-workspace.js";
import { task } from "../schemas/task.js";
import { workspaceFormerSlug } from "../schemas/workspace-former-slug.js";
import {
  PERSONAL_WORKSPACE_METADATA,
  type WorkspaceCreation,
  type WorkspaceSeams,
} from "./workspace-seams.js";
import { formerSlugHeld } from "./workspace-slug-store.js";

const PERSONAL_SUFFIX_CHARS = 8;

const PHOTO_VERSION_CHARS = 16;

export type Workspace = WireWorkspace;

export const WORKSPACE_NAME = sql<string>`coalesce((select "owner"."name" from ${personalWorkspace} as "personal" inner join ${user} as "owner" on "owner"."id" = "personal"."user_id" where "personal"."organization_id" = ${organization.id}), ${organization.name})`;

const FORMER_SLUGS = sql<string>`coalesce((select string_agg("former"."slug", ' ' order by "former"."slug") from ${workspaceFormerSlug} as "former" where "former"."organization_id" = ${organization.id}), '')`;

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
  personalOf: Schema.NullOr(Schema.String),
  personal: Schema.Boolean,
  role: Schema.String,
  memberCount: Schema.Number,
  logo: Schema.NullOr(Schema.String),
  ownerImage: Schema.NullOr(Schema.String),
  formerSlugs: Schema.String,
});

const InstallationRowSchema = Schema.Struct({
  organizationId: Schema.String,
  installationId: Schema.Number,
  accountId: Schema.Number,
  login: Schema.String,
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

const findAccountFace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ name: Schema.String, githubLogin: Schema.NullOr(Schema.String) }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ name: user.name, githubLogin: githubPersonalToken.githubLogin })
        .from(user)
        .leftJoin(githubPersonalToken, eq(githubPersonalToken.userId, user.id))
        .where(eq(user.id, userId)),
    ),
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

const findOwnedPersonalOrganization = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: OrganizationIdSchema,
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ organizationId: member.organizationId })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(
          and(
            eq(member.userId, userId),
            eq(member.organizationId, organizationId),
            eq(member.role, WORKSPACE_ROLE.OWNER),
            eq(organization.metadata, JSON.stringify(PERSONAL_WORKSPACE_METADATA)),
            sql`not exists (select 1 from ${personalWorkspace} as "other" where "other"."organization_id" = ${organization.id} and "other"."user_id" <> ${userId})`,
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

export function roleAmong(roles: readonly WorkspaceRole[]): SQL {
  return sql`string_to_array(replace(${member.role}, ' ', ''), ',') && array[${sql.join(
    roles.map((role) => sql`${role}`),
    sql`, `,
  )}]::text[]`;
}

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

const findMemberWorkspaceIds = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, userId)),
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

const WorkspaceFaceSchema = Schema.Struct({ name: Schema.String, createdAt: Schema.Date });

const findWorkspaceFace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: WorkspaceFaceSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ name: WORKSPACE_NAME, createdAt: organization.createdAt })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1),
    ),
});

function workspaceRows(db: DatabaseShape, userId: string, organizationId?: string) {
  return db
    .select({
      id: organization.id,
      name: WORKSPACE_NAME,
      slug: organization.slug,
      personalOf: personalWorkspace.userId,
      personal: sql<boolean>`exists(select 1 from ${personalWorkspace} as "first" where "first"."organization_id" = ${organization.id})`,
      role: member.role,
      memberCount: sql<number>`(select count(*)::int from ${member} as "members" where "members"."organization_id" = ${organization.id})`,
      logo: organization.logo,
      ownerImage: user.image,
      formerSlugs: FORMER_SLUGS,
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
    .where(
      and(
        eq(member.userId, userId),
        organizationId === undefined ? undefined : eq(organization.id, organizationId),
      ),
    )
    .orderBy(asc(WORKSPACE_NAME), asc(organization.id));
}

function installationRows(db: DatabaseShape, userId: string, organizationId?: string) {
  return db
    .select({
      organizationId: githubInstallation.organizationId,
      installationId: githubInstallation.installationId,
      accountId: githubInstallation.accountId,
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

function photoOfLogo(logo: string | null): WorkspacePhoto | undefined {
  return logo === null ? undefined : workspacePhotoOfDataUrl(logo);
}

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

function workspaceOfRow(
  row: typeof WorkspaceRowSchema.Type,
  installations: readonly InstallationRow[],
): Workspace {
  const githubInstallations = installations.map((installation) => ({
    installationId: installation.installationId,
    login: installation.login,
    active: installation.status === GITHUB_INSTALLATION_STATUS.ACTIVE,
  }));
  const first = githubInstallations.find((one) => one.active) ?? githubInstallations[0];
  const workspace: Workspace = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: roleOf(row.role),
    github: first === undefined ? null : { login: first.login, active: first.active },
    githubInstallations,
    memberCount: row.memberCount,
    ...faceOfRow(row),
    ...formerSlugsOf(row.formerSlugs),
  };
  return row.personal ? { ...workspace, personal: true } : workspace;
}

function spelledSlugOf(name: string): string {
  const spelled = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, WORKSPACE_BOUNDS.MAX_SLUG_CHARS)
    .replace(/-+$/u, "");
  if (spelled === "") return "";
  const own =
    spelled.startsWith(PERSONAL_WORKSPACE_SLUG_PREFIX) || RESERVED_WORKSPACE_SLUGS.has(spelled);
  return own ? `workspace-${spelled}` : spelled;
}

function slugOf(name: string): string {
  return spelledSlugOf(name) || "workspace";
}

type OrganizationLinked = (organizationId: string) => WorkspaceStoreEffect<boolean>;

function personalSlugsOf(
  userId: string,
  name: string,
  githubLogin: string | null,
): readonly [string, ...string[]] {
  const fallback = `${PERSONAL_WORKSPACE_SLUG_PREFIX}${userId}`;
  const last = `${fallback}-${randomUUID()}`;
  const readable = spelledSlugOf(name) || spelledSlugOf(githubLogin ?? "");
  if (readable === "") return [fallback, last];
  const suffix = createHash("sha256").update(userId).digest("hex").slice(0, PERSONAL_SUFFIX_CHARS);
  return [readable, `${readable}-${suffix}`, fallback, last];
}

function createLinkedOrganization(
  creation: Omit<WorkspaceCreation, "slug">,
  slugs: readonly [string, ...string[]],
  linked: OrganizationLinked,
  seams: WorkspaceSeams,
): WorkspaceStoreEffect<string, Cause.UnknownError> {
  const [slug, ...rest] = slugs;
  const [next, ...after] = rest;
  if (next !== undefined) {
    return Effect.flatMap(formerSlugHeld(slug), (held) =>
      held
        ? createLinkedOrganization(creation, [next, ...after], linked, seams)
        : madeOrAdopted(creation, slug, [next, ...after], linked, seams),
    );
  }
  return madeOrAdopted(creation, slug, [], linked, seams);
}

function madeOrAdopted(
  creation: Omit<WorkspaceCreation, "slug">,
  slug: string,
  rest: readonly string[],
  linked: OrganizationLinked,
  seams: WorkspaceSeams,
): WorkspaceStoreEffect<string, Cause.UnknownError> {
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

function isOwnPersonalOrganization(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<boolean> {
  return Effect.map(findOwnedPersonalOrganization({ userId, organizationId }), Option.isSome);
}

export function workspaceReachableBy(userId: string, organizationId: string | SQLWrapper): SQL {
  return memberOfWorkspace(userId, organizationId);
}

export const AGENT_WORKSPACE = sql<string>`${agentTable.organizationId}`;

interface GitHubReachedColumns {
  readonly access: SQLWrapper;
  readonly owner: SQLWrapper;
  readonly repository: SQLWrapper;
}

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

export function agentSeenBy(userId: string): SQL {
  return seenThroughGitHub(userId, {
    access: agentTable.githubAccess,
    owner: agentTable.userId,
    repository: agentTable.repository,
  });
}

export function agentReachableBy(userId: string): SQL {
  return sql`(${memberOfWorkspace(userId, AGENT_WORKSPACE)} and ${agentSeenBy(userId)})`;
}

export function agentVisibleTo(userId: string): SQL {
  const taskReached = exists(
    queryBuilder
      .select({ one: task.id })
      .from(task)
      .where(and(eq(task.id, agentTable.taskId), taskReachableBy(userId))),
  );
  return sql`(${agentReachableBy(userId)} and (${agentTable.taskId} is null or ${taskReached}))`;
}

export function taskSeenBy(userId: string): SQL {
  return seenThroughGitHub(userId, {
    access: task.githubAccess,
    owner: task.userId,
    repository: task.repository,
  });
}

export function taskReachableBy(userId: string): SQL {
  return sql`(${memberOfWorkspace(userId, task.organizationId)} and ${taskSeenBy(userId)})`;
}

export function reachableTask(userId: string, taskId: string): SQL | undefined {
  return and(eq(task.id, taskId), taskReachableBy(userId));
}

export function personalWorkspaceOf(userId: string): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.map(
    findPersonalWorkspace(userId),
    Option.map((row) => row.organizationId),
  );
}

export function ensurePersonalWorkspace(
  userId: string,
  seams: WorkspaceSeams,
): WorkspaceStoreEffect<Option.Option<string>, Cause.UnknownError> {
  return Effect.gen(function* () {
    const standing = yield* personalWorkspaceOf(userId);
    if (Option.isSome(standing)) return standing;
    const account = yield* findAccountFace(userId);
    if (Option.isNone(account)) return Option.none();
    const { name, githubLogin } = account.value;
    const organizationId = yield* createLinkedOrganization(
      { name, userId, metadata: PERSONAL_WORKSPACE_METADATA },
      personalSlugsOf(userId, name, githubLogin),
      (candidate) => isOwnPersonalOrganization(userId, candidate),
      seams,
    );
    const now = yield* DateTime.nowAsDate;
    yield* insertPersonalWorkspace({ userId, organizationId, now });
    return yield* personalWorkspaceOf(userId);
  });
}

export function isWorkspaceMember(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<boolean> {
  return Effect.map(findMemberWorkspace({ userId, organizationId }), Option.isSome);
}

export function memberWorkspaceIds(userId: string): WorkspaceStoreEffect<readonly string[]> {
  return Effect.map(findMemberWorkspaceIds(userId), (rows) =>
    rows.map((row) => row.organizationId),
  );
}

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

export type WorkspacesLiveStatements = Readonly<
  Record<"workspaces" | "installations", LiveStatement>
>;

const LOGO_BYTES = sql`decode(replace(${organization.logo}, ${"\\"}, ${"\\\\"}), 'escape')`;

const LOGO_PAYLOAD = sql`substring(${organization.logo} from position(',' in ${organization.logo}) + 1)`;

const LOGO_HEAD = sql`decode(left(${LOGO_PAYLOAD}, 16), 'base64')`;

const LOGO_IS_PHOTO = sql<boolean>`case when coalesce(${organization.logo} ~ ${`^data:(${Object.values(WORKSPACE_PHOTO_TYPE).join("|")});base64,[A-Za-z0-9+/]+={0,2}$`}, false) and length(${LOGO_PAYLOAD}) % 4 = 0 then case split_part(substring(${organization.logo} from 6), ';', 1)
  when ${WORKSPACE_PHOTO_TYPE.PNG} then substring(${LOGO_HEAD} from 1 for 8) = '\\x89504e470d0a1a0a'::bytea
  when ${WORKSPACE_PHOTO_TYPE.JPEG} then substring(${LOGO_HEAD} from 1 for 3) = '\\xffd8ff'::bytea
  when ${WORKSPACE_PHOTO_TYPE.WEBP} then substring(${LOGO_HEAD} from 1 for 4) = '\\x52494646'::bytea and substring(${LOGO_HEAD} from 9 for 4) = '\\x57454250'::bytea
  else false end else false end`;

export function workspacesLiveStatements(userId: string): Option.Option<WorkspacesLiveStatements> {
  const workspaces = queryBuilder
    .select(
      liveSelection({
        id: organization.id,
        name: WORKSPACE_NAME,
        slug: organization.slug,
        own: sql<boolean>`${personalWorkspace.userId} is not null`,
        personal: sql<boolean>`exists(select 1 from ${personalWorkspace} as "first" where "first"."organization_id" = ${organization.id})`,
        role: member.role,
        linearActive: sql<null>`null::boolean`,
        memberCount: sql<number>`(select count(*)::int from ${member} as "members" where "members"."organization_id" = ${organization.id})`,
        photoVersion: sql<
          string | null
        >`case when ${LOGO_IS_PHOTO} then left(encode(sha256(${LOGO_BYTES}), 'hex'), ${PHOTO_VERSION_CHARS}) end`,
        ownerImage: user.image,
        formerSlugs: FORMER_SLUGS,
      }),
    )
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
    .where(eq(member.userId, userId));
  const installations = queryBuilder
    .select(
      liveSelection(
        {
          workspaceId: githubInstallation.organizationId,
          installationId: sql<number>`${githubInstallation.installationId}::float8`,
          login: githubInstallation.accountLogin,
          active: sql<boolean>`${githubInstallation.status} = ${GITHUB_INSTALLATION_STATUS.ACTIVE}`,
        },
        { linkedAt: githubInstallation.createdAt },
      ),
    )
    .from(githubInstallation)
    .innerJoin(member, eq(member.organizationId, githubInstallation.organizationId))
    .where(eq(member.userId, userId));
  return Option.all({
    workspaces: liveStatementOf(workspaces),
    installations: liveStatementOf(installations),
  });
}

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

export function workspaceGitHubAccountId(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<Option.Option<number>> {
  return Effect.map(findInstallations({ userId, organizationId }), (installations) => {
    const active = installations.find((one) => one.status === GITHUB_INSTALLATION_STATUS.ACTIVE);
    return Option.fromNullishOr((active ?? installations[0])?.accountId);
  });
}

export function readWorkspacePhoto(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<Option.Option<WorkspacePhoto>> {
  return Effect.map(findWorkspaceLogo({ userId, organizationId }), (found) =>
    Option.flatMap(found, (row) => Option.fromNullishOr(photoOfLogo(row.logo))),
  );
}

export type WorkspaceFace = typeof WorkspaceFaceSchema.Type;

export function readWorkspaceFace(
  organizationId: string,
): WorkspaceStoreEffect<Option.Option<WorkspaceFace>> {
  return findWorkspaceFace(organizationId);
}

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
