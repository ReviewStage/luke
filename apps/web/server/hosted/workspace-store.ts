import { and, asc, eq } from "drizzle-orm";
import { type Cause, DateTime, Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import { member, organization, user } from "../db/auth-schema.js";
import { personalWorkspace } from "../db/personal-workspace-schema.js";
import { db } from "../db/query.js";
import type { StoreFailure } from "./store-failure.js";
import type { WorkspaceSeams } from "./workspace-seams.js";

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
 * Every function is an effect over the ambient `SqlClient`.
 */

/** The slug every personal workspace is made under, one per account, which is what makes the plugin refuse a second. */
const PERSONAL_SLUG_PREFIX = "personal-";

/** The metadata the plugin stores on a personal workspace, as JSON text; only the server writes it. */
const PERSONAL_WORKSPACE_METADATA = { personal: true } as const;

/** One workspace as its members see it: the account's own one is marked personal. */
export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly personal: boolean;
}

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

const findAccountByEmail = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (email) => db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1),
});

const findPersonalOwner = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ userId: Schema.String }),
  execute: (organizationId) =>
    db
      .select({ userId: personalWorkspace.userId })
      .from(personalWorkspace)
      .where(eq(personalWorkspace.organizationId, organizationId))
      .limit(1),
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

const findWorkspaces = SqlSchema.findAll({
  Request: Schema.String,
  Result: WorkspaceRowSchema,
  execute: (userId) =>
    db
      .select({
        id: organization.id,
        name: organization.name,
        personalOf: personalWorkspace.userId,
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
      .where(eq(member.userId, userId))
      .orderBy(asc(organization.name), asc(organization.id)),
});

/**
 * The workspace the plugin holds under the account's personal slug: the one
 * this call just made, or, where the plugin refused because the slug was
 * taken, the one a racing ensure made first. Nothing under the slug means
 * the plugin's refusal was something else, and it is answered as it was.
 */
function createPersonalOrganization(
  userId: string,
  name: string,
  seams: WorkspaceSeams,
): WorkspaceStoreEffect<string, Cause.UnknownError> {
  const slug = `${PERSONAL_SLUG_PREFIX}${userId}`;
  return seams
    .createOrganization({ name, slug, userId, metadata: PERSONAL_WORKSPACE_METADATA })
    .pipe(
      Effect.map((created) => created.id),
      Effect.catch((refusal) =>
        Effect.flatMap(findOrganizationBySlug(slug), (standing) =>
          Option.match(standing, {
            onNone: () => Effect.fail(refusal),
            onSome: (row) => Effect.succeed(row.organizationId),
          }),
        ),
      ),
    );
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
    const organizationId = yield* createPersonalOrganization(userId, account.value.name, seams);
    const now = yield* DateTime.nowAsDate;
    yield* insertPersonalWorkspace({ userId, organizationId, now });
    return yield* personalWorkspaceOf(userId);
  });
}

/** Whether the workspace is some account's personal one, which nobody else joins. */
export function isPersonalWorkspace(organizationId: string): WorkspaceStoreEffect<boolean> {
  return Effect.map(findPersonalOwner(organizationId), Option.isSome);
}

/**
 * The account that signs in with this address, by id; nothing for an address
 * no account holds. Better Auth stores every address lowercased, so the one
 * asked for is too.
 */
export function accountOfEmail(email: string): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.map(
    findAccountByEmail(email.toLowerCase()),
    Option.map((row) => row.id),
  );
}

/** Every workspace the account is a member of, its personal one first and the rest by name. */
export function listWorkspaces(userId: string): WorkspaceStoreEffect<readonly Workspace[]> {
  return Effect.map(findWorkspaces(userId), (rows) => {
    const workspaces = rows.map((row) => ({
      id: row.id,
      name: row.name,
      personal: row.personalOf !== null,
    }));
    return [
      ...workspaces.filter((workspace) => workspace.personal),
      ...workspaces.filter((workspace) => !workspace.personal),
    ];
  });
}
