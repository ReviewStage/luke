import { createHash } from "node:crypto";
import {
  INSTALLED_SKILL_BOUNDS,
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_REFUSAL,
  INSTALLED_SKILL_SCOPE,
  type InstalledSkillRefusal,
  type InstalledSkillSource,
  installedSkillScopeSchema,
  installedSkillSourceSchema,
} from "@luke/features/installed-skill-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@luke/features/workspace-wire";
import { and, asc, eq, exists, inArray, or, type SQL, sql } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder } from "../core/query.js";
import { member } from "../schemas/auth.js";
import { installedSkill, installedSkillFile } from "../schemas/installed-skill.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect, TaskStoreFailure } from "./task-store.js";

/**
 * installed-skill-store.ts -- the skills members install into Luke: installed, listed, read with their files, replaced, toggled, and removed, each by its own rule.
 *
 * A personal skill is its installer's alone: only they read, change,
 * toggle, and remove it, in whichever workspace they work, since it names
 * none. A workspace skill is its workspace's: every current member reads
 * it and their agents use it, and only its current owners and admins
 * install, change, toggle, and remove it, its installer among them only
 * while they are one. Every statement names the account beside the skill
 * and gates on that rule in SQL, so a member who leaves a workspace reaches
 * none of its skills at once. A skill and its files are written in one
 * transaction: the files are checked first, at least `SKILL.md` and within
 * `INSTALLED_SKILL_BOUNDS`, which a check on one row cannot hold, while the
 * name's rule and each file's own bound are the tables' checks. A name
 * already held in its scope is refused as `InstalledSkillNameTaken`.
 */

/** A skill's name already held in its scope: by the account's own personal skill, or by the workspace's. */
export class InstalledSkillNameTaken extends Data.TaggedError("InstalledSkillNameTaken")<{
  readonly name: string;
}> {}

/** A skill's files refused before anything was written, and why. */
export class InstalledSkillFilesRefused extends Data.TaggedError("InstalledSkillFilesRefused")<{
  readonly reason: InstalledSkillRefusal;
}> {}

const InstalledSkillRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  /** The workspace of a workspace skill; null for a personal one. */
  organizationId: Schema.NullOr(Schema.String),
  scope: installedSkillScopeSchema,
  name: Schema.String,
  description: Schema.String,
  userInvocable: Schema.Boolean,
  source: installedSkillSourceSchema,
  computedHash: Schema.String,
  enabled: Schema.Boolean,
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

/** One installed skill as a list reads it, without its files. */
export type InstalledSkill = typeof InstalledSkillRowSchema.Type;

const INSTALLED_SKILL_COLUMNS = {
  id: installedSkill.id,
  userId: installedSkill.userId,
  organizationId: installedSkill.organizationId,
  scope: installedSkill.scope,
  name: installedSkill.name,
  description: installedSkill.description,
  userInvocable: installedSkill.userInvocable,
  source: installedSkill.source,
  computedHash: installedSkill.computedHash,
  enabled: installedSkill.enabled,
  createdAt: installedSkill.createdAt,
  updatedAt: installedSkill.updatedAt,
};

const FileRowSchema = Schema.Struct({
  skillId: Schema.String,
  path: Schema.String,
  bytes: Schema.Uint8Array,
  sha256: Schema.String,
});

/** One file of an installed skill: its path from the skill's folder, its bytes, and their hex SHA-256. */
export interface InstalledSkillFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/** One installed skill with its files, in path order. */
export interface InstalledSkillWithFiles extends InstalledSkill {
  readonly files: readonly InstalledSkillFile[];
}

/** A file to install: its path from the skill's folder, such as `SKILL.md` or `scripts/run.sh`, and its bytes. */
export interface InstalledSkillFileInput {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Whose a new skill is: the installer's own, or a workspace's they own or administer. */
export type InstalledSkillOwner =
  | { readonly scope: typeof INSTALLED_SKILL_SCOPE.PERSONAL }
  | { readonly scope: typeof INSTALLED_SKILL_SCOPE.WORKSPACE; readonly organizationId: string };

/** What a skill's files and source become on an update: what its new `SKILL.md` says of it, where it came from, and every file. */
export interface InstalledSkillRevision {
  readonly description: string;
  readonly userInvocable: boolean;
  readonly source: InstalledSkillSource;
  readonly files: readonly InstalledSkillFileInput[];
}

/** What installing a skill takes: whose it is, its name, and its revision. */
export interface NewInstalledSkill extends InstalledSkillRevision {
  readonly owner: InstalledSkillOwner;
  readonly name: string;
}

/** What an account asks to do with an installed skill: read and use it, or change, toggle, and remove it. */
export const INSTALLED_SKILL_ACCESS = {
  READ: "read",
  MANAGE: "manage",
} as const;

export type InstalledSkillAccess =
  (typeof INSTALLED_SKILL_ACCESS)[keyof typeof INSTALLED_SKILL_ACCESS];

/** The roles that manage a workspace's skills. */
const MANAGING_ROLES: readonly WorkspaceRole[] = [WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN];

/** The condition that the plugin's role text, which may name several comma-separated, names one of `roles`. */
function roleAmong(roles: readonly WorkspaceRole[]): SQL {
  return sql`string_to_array(replace(${member.role}, ' ', ''), ',') && array[${sql.join(
    roles.map((role) => sql`${role}`),
    sql`, `,
  )}]::text[]`;
}

/** The condition that the account is a current member of the workspace named, in one of `roles` where it names any. */
function memberOf(
  userId: string,
  organizationId: string | typeof installedSkill.organizationId,
  roles?: readonly WorkspaceRole[],
): SQL {
  return exists(
    queryBuilder
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, userId),
          roles === undefined ? undefined : roleAmong(roles),
        ),
      ),
  );
}

/** The condition that the skill is the account's own personal one. */
function ownPersonal(userId: string): SQL | undefined {
  return and(
    eq(installedSkill.scope, INSTALLED_SKILL_SCOPE.PERSONAL),
    eq(installedSkill.userId, userId),
  );
}

/**
 * The condition that the account may do `access` with the skill a
 * statement names: its own personal skill, or a skill of a workspace it is
 * a current member of, as an owner or admin to manage one.
 */
function allowedTo(userId: string, access: InstalledSkillAccess, id?: string): SQL | undefined {
  const roles = access === INSTALLED_SKILL_ACCESS.MANAGE ? MANAGING_ROLES : undefined;
  return and(
    id === undefined ? undefined : eq(installedSkill.id, id),
    or(
      ownPersonal(userId),
      and(
        eq(installedSkill.scope, INSTALLED_SKILL_SCOPE.WORKSPACE),
        memberOf(userId, installedSkill.organizationId, roles),
      ),
    ),
  );
}

/** The condition that the skill is one the account's agents are offered in the workspace: its own personal ones, and the workspace's where it is a member. */
function offeredIn(userId: string, organizationId: string | null): SQL | undefined {
  return or(
    ownPersonal(userId),
    organizationId === null
      ? undefined
      : and(
          eq(installedSkill.scope, INSTALLED_SKILL_SCOPE.WORKSPACE),
          eq(installedSkill.organizationId, organizationId),
          memberOf(userId, organizationId),
        ),
  );
}

/** Workspace skills before personal ones, then by name. */
const OFFERED_ORDER = [
  sql`case when ${installedSkill.scope} = ${INSTALLED_SKILL_SCOPE.WORKSPACE} then 0 else 1 end`,
  asc(installedSkill.name),
];

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The files with their hashes, in path order. */
function hashedFiles(files: readonly InstalledSkillFileInput[]): readonly InstalledSkillFile[] {
  return files
    .map((file) => ({ path: file.path, bytes: file.bytes, sha256: sha256Hex(file.bytes) }))
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The skill's hash: the SHA-256 over each file's path and hash, in path order, so the same files hash the same whichever order they came in. */
function skillHash(files: readonly InstalledSkillFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\n`);
  return hash.digest("hex");
}

/** Why the files may not be a skill's, or none where they may. */
function refusalOf(
  files: readonly InstalledSkillFileInput[],
): Option.Option<InstalledSkillRefusal> {
  const paths = new Set(files.map((file) => file.path));
  const bytes = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (!paths.has(INSTALLED_SKILL_MAIN_FILE)) {
    return Option.some(INSTALLED_SKILL_REFUSAL.NO_SKILL_FILE);
  }
  if (paths.size !== files.length) return Option.some(INSTALLED_SKILL_REFUSAL.DUPLICATE_PATH);
  if (files.length > INSTALLED_SKILL_BOUNDS.MAX_FILES) {
    return Option.some(INSTALLED_SKILL_REFUSAL.TOO_MANY_FILES);
  }
  if (bytes > INSTALLED_SKILL_BOUNDS.MAX_TOTAL_BYTES) {
    return Option.some(INSTALLED_SKILL_REFUSAL.TOO_LARGE);
  }
  return Option.none();
}

/** The files hashed, or the refusal of them. */
function checkedFiles(
  files: readonly InstalledSkillFileInput[],
): Effect.Effect<readonly InstalledSkillFile[], InstalledSkillFilesRefused> {
  return Option.match(refusalOf(files), {
    onNone: () => Effect.succeed(hashedFiles(files)),
    onSome: (reason) => Effect.fail(new InstalledSkillFilesRefused({ reason })),
  });
}

const findManagedWorkspace = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, userId),
            roleAmong(MANAGING_ROLES),
          ),
        ),
    ),
});

const insertSkill = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    organizationId: Schema.NullOr(Schema.String),
    scope: installedSkillScopeSchema,
    name: Schema.String,
    description: Schema.String,
    userInvocable: Schema.Boolean,
    source: installedSkillSourceSchema,
    computedHash: Schema.String,
    now: Schema.Date,
  }),
  Result: InstalledSkillRowSchema,
  execute: ({ now, ...row }) =>
    Database.use((db) =>
      db
        .insert(installedSkill)
        .values({ ...row, enabled: true, createdAt: now, updatedAt: now })
        // Note that the conflict is a name held in its scope, by either partial index.
        .onConflictDoNothing()
        .returning(INSTALLED_SKILL_COLUMNS),
    ),
});

const insertFiles = SqlSchema.void({
  Request: Schema.Struct({
    skillId: Schema.String,
    files: Schema.Array(
      Schema.Struct({ path: Schema.String, bytes: Schema.Uint8Array, sha256: Schema.String }),
    ),
  }),
  execute: ({ skillId, files }) =>
    Database.use((db) =>
      db.insert(installedSkillFile).values(files.map((file) => ({ ...file, skillId }))),
    ),
});

const deleteFiles = SqlSchema.void({
  Request: Schema.String,
  execute: (skillId) =>
    Database.use((db) =>
      db.delete(installedSkillFile).where(eq(installedSkillFile.skillId, skillId)),
    ),
});

const findSkill = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    access: Schema.Literals(Object.values(INSTALLED_SKILL_ACCESS)),
  }),
  Result: InstalledSkillRowSchema,
  execute: ({ userId, id, access }) =>
    Database.use((db) =>
      db
        .select(INSTALLED_SKILL_COLUMNS)
        .from(installedSkill)
        .where(allowedTo(userId, access, id)),
    ),
});

const findOffered = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    organizationId: Schema.NullOr(Schema.String),
    enabledOnly: Schema.Boolean,
  }),
  Result: InstalledSkillRowSchema,
  execute: ({ userId, organizationId, enabledOnly }) =>
    Database.use((db) =>
      db
        .select(INSTALLED_SKILL_COLUMNS)
        .from(installedSkill)
        .where(
          and(
            offeredIn(userId, organizationId),
            enabledOnly ? eq(installedSkill.enabled, true) : undefined,
          ),
        )
        .orderBy(...OFFERED_ORDER),
    ),
});

const findFiles = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: FileRowSchema,
  execute: (skillIds) =>
    Database.use((db) =>
      db
        .select({
          skillId: installedSkillFile.skillId,
          path: installedSkillFile.path,
          bytes: installedSkillFile.bytes,
          sha256: installedSkillFile.sha256,
        })
        .from(installedSkillFile)
        .where(inArray(installedSkillFile.skillId, skillIds))
        .orderBy(asc(installedSkillFile.skillId), asc(installedSkillFile.path)),
    ),
});

const writeRevision = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    description: Schema.String,
    userInvocable: Schema.Boolean,
    source: installedSkillSourceSchema,
    computedHash: Schema.String,
    now: Schema.Date,
  }),
  Result: InstalledSkillRowSchema,
  execute: ({ userId, id, now, ...changes }) =>
    Database.use((db) =>
      db
        .update(installedSkill)
        .set({ ...changes, updatedAt: now })
        .where(allowedTo(userId, INSTALLED_SKILL_ACCESS.MANAGE, id))
        .returning(INSTALLED_SKILL_COLUMNS),
    ),
});

const writeEnabled = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    enabled: Schema.Boolean,
    now: Schema.Date,
  }),
  Result: InstalledSkillRowSchema,
  execute: ({ userId, id, enabled, now }) =>
    Database.use((db) =>
      db
        .update(installedSkill)
        .set({ enabled, updatedAt: now })
        .where(allowedTo(userId, INSTALLED_SKILL_ACCESS.MANAGE, id))
        .returning(INSTALLED_SKILL_COLUMNS),
    ),
});

const removeSkill = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .delete(installedSkill)
        .where(allowedTo(userId, INSTALLED_SKILL_ACCESS.MANAGE, id))
        .returning({ id: installedSkill.id }),
    ),
});

/** The skills with their files, in the order given, read in one statement. */
function withFiles(
  skills: readonly InstalledSkill[],
): TaskStoreEffect<readonly InstalledSkillWithFiles[]> {
  if (skills.length === 0) return Effect.succeed([]);
  return Effect.map(findFiles(skills.map((skill) => skill.id)), (rows) => {
    const bySkill = new Map<string, InstalledSkillFile[]>();
    for (const { skillId, ...file } of rows) {
      const held = bySkill.get(skillId) ?? [];
      held.push(file);
      bySkill.set(skillId, held);
    }
    return skills.map((skill) => ({ ...skill, files: bySkill.get(skill.id) ?? [] }));
  });
}

/** Runs the effect in one transaction. */
function inTransaction<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | TaskStoreFailure, R | DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(effect));
}

/** The skills the account sees in the workspace, metadata alone: the workspace's where it is a current member, then its own personal ones, each by name. */
export function listInstalledSkills(
  userId: string,
  organizationId: string,
): TaskStoreEffect<readonly InstalledSkill[]> {
  return findOffered({ userId, organizationId, enabledOnly: false });
}

/** One skill the account may do `access` with, reading by default, with its files; nothing for any other id. */
export function readInstalledSkill(
  userId: string,
  id: string,
  access: InstalledSkillAccess = INSTALLED_SKILL_ACCESS.READ,
): TaskStoreEffect<Option.Option<InstalledSkillWithFiles>> {
  return Effect.flatMap(findSkill({ userId, id, access }), (found) =>
    Option.match(found, {
      onNone: () => Effect.succeed(Option.none()),
      onSome: (skill) => Effect.map(withFiles([skill]), ([read]) => Option.fromUndefinedOr(read)),
    }),
  );
}

/**
 * Installs the skill with its files, enabled, in one transaction: nothing
 * where the account may not install in its scope (a workspace it does not
 * own or administer), `InstalledSkillNameTaken` where its scope holds the
 * name already, and `InstalledSkillFilesRefused` where its files break
 * the bounds.
 */
export function installSkill(
  userId: string,
  made: NewInstalledSkill,
): Effect.Effect<
  Option.Option<InstalledSkill>,
  TaskStoreFailure | InstalledSkillNameTaken | InstalledSkillFilesRefused,
  DatabaseServices
> {
  return Effect.gen(function* () {
    const files = yield* checkedFiles(made.files);
    const organizationId =
      made.owner.scope === INSTALLED_SKILL_SCOPE.WORKSPACE ? made.owner.organizationId : null;
    return yield* inTransaction(
      Effect.gen(function* () {
        if (organizationId !== null) {
          const managed = yield* findManagedWorkspace({ userId, organizationId });
          if (managed.length === 0) return Option.none();
        }
        const now = yield* DateTime.nowAsDate;
        const [row] = yield* insertSkill({
          userId,
          organizationId,
          scope: made.owner.scope,
          name: made.name,
          description: made.description,
          userInvocable: made.userInvocable,
          source: made.source,
          computedHash: skillHash(files),
          now,
        });
        if (row === undefined) return yield* new InstalledSkillNameTaken({ name: made.name });
        yield* insertFiles({ skillId: row.id, files });
        return Option.some(row);
      }),
    );
  });
}

/**
 * Replaces a skill's files and source, and what its `SKILL.md` says of it,
 * in one transaction, where the account may manage it; nothing for any
 * other id, and `InstalledSkillFilesRefused` where the files break the
 * bounds. Its name, scope, and toggle stand.
 */
export function updateInstalledSkill(
  userId: string,
  id: string,
  revision: InstalledSkillRevision,
): Effect.Effect<
  Option.Option<InstalledSkill>,
  TaskStoreFailure | InstalledSkillFilesRefused,
  DatabaseServices
> {
  return Effect.gen(function* () {
    const files = yield* checkedFiles(revision.files);
    return yield* inTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const [row] = yield* writeRevision({
          userId,
          id,
          description: revision.description,
          userInvocable: revision.userInvocable,
          source: revision.source,
          computedHash: skillHash(files),
          now,
        });
        if (row === undefined) return Option.none();
        yield* deleteFiles(id);
        yield* insertFiles({ skillId: id, files });
        return Option.some(row);
      }),
    );
  });
}

/** Turns a skill the account may manage on or off, answering it as it now stands; nothing for any other id. */
export function setInstalledSkillEnabled(
  userId: string,
  id: string,
  enabled: boolean,
): TaskStoreEffect<Option.Option<InstalledSkill>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeEnabled({ userId, id, enabled, now }), (rows) =>
      Option.fromUndefinedOr(rows[0]),
    ),
  );
}

/** Removes a skill the account may manage, and its files; false for any other id. */
export function removeInstalledSkill(userId: string, id: string): TaskStoreEffect<boolean> {
  return Effect.map(removeSkill({ userId, id }), (rows) => rows.length > 0);
}

/**
 * The enabled skills an agent the account starts is offered, with their
 * files, for its session: the workspace's, where it names one the account
 * is a current member of, then the account's own personal ones, each by
 * name. An agent on no workspace is offered the personal ones alone.
 */
export function sessionInstalledSkills(
  userId: string,
  organizationId: string | null,
): TaskStoreEffect<readonly InstalledSkillWithFiles[]> {
  return Effect.flatMap(findOffered({ userId, organizationId, enabledOnly: true }), withFiles);
}
