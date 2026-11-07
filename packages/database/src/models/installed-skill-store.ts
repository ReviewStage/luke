import {
  holdsFileTooLarge,
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_REFUSAL,
  INSTALLED_SKILL_SCOPE,
  type InstalledSkillRefusal,
  type InstalledSkillSource,
  installedSkillScopeSchema,
  installedSkillSourceSchema,
} from "@repo/features/installed-skill-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
import { and, asc, eq, exists, or, type SQL, sql } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, queryBuilder } from "../core/query.js";
import { member } from "../schemas/auth.js";
import { installedSkill, installedSkillFile } from "../schemas/installed-skill.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect, TaskStoreFailure } from "./task-store.js";
import { roleAmong } from "./workspace-store.js";

/**
 * installed-skill-store.ts -- the skills members install: installed, listed, read with their files, and removed, each by its own rule.
 *
 * A personal skill is its installer's alone: only they read and remove
 * it, in whichever workspace they work, since it names none. A workspace
 * skill is its workspace's: every current member reads it, installs one,
 * and has their agents use it, and its installer while still a member, or
 * its current owners and admins, remove it, as an automation is changed.
 * A workspace skill outlives its
 * installer's account, which is kept for attribution alone. Every statement names the account beside the skill
 * and gates on that rule in SQL, so a member who leaves a workspace reaches
 * none of its skills at once. A skill and its files are written in one
 * transaction: the files are checked first, at least `SKILL.md` and none
 * past `INSTALLED_SKILL_BOUNDS`, so an oversized file is refused in words
 * rather than by the table's check, which holds the same bound beside the
 * name's rule and a path held once per skill. A name
 * already held in its scope is refused as `InstalledSkillNameTaken`. Every
 * write answers the transaction it committed in, which a reader holding the
 * skills live (`installedSkillsLiveStatement`) waits for.
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
  /** The account a personal skill is; null for a workspace one. */
  ownerUserId: Schema.NullOr(Schema.String),
  /** Who installed it, for attribution; null once their account is gone. */
  installedByUserId: Schema.NullOr(Schema.String),
  /** The workspace of a workspace skill; null for a personal one. */
  organizationId: Schema.NullOr(Schema.String),
  scope: installedSkillScopeSchema,
  name: Schema.String,
  description: Schema.String,
  userInvocable: Schema.Boolean,
  source: installedSkillSourceSchema,
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

/** One installed skill as a list reads it, without its files. */
export type InstalledSkill = typeof InstalledSkillRowSchema.Type;

/** A skill as a write left it, beside the transaction it committed in. */
const WrittenSkillRowSchema = Schema.Struct({
  ...InstalledSkillRowSchema.fields,
  txid: Schema.String,
});

/** One installed skill as a write left it, and the transaction it committed in, which a reader following the skills waits for. */
export type WrittenSkill = typeof WrittenSkillRowSchema.Type;

const INSTALLED_SKILL_COLUMNS = {
  id: installedSkill.id,
  ownerUserId: installedSkill.ownerUserId,
  installedByUserId: installedSkill.installedByUserId,
  organizationId: installedSkill.organizationId,
  scope: installedSkill.scope,
  name: installedSkill.name,
  description: installedSkill.description,
  userInvocable: installedSkill.userInvocable,
  source: installedSkill.source,
  createdAt: installedSkill.createdAt,
  updatedAt: installedSkill.updatedAt,
};

/**
 * The id of the transaction a write committed in, read in its own
 * `RETURNING`; within a store transaction's savepoint it is still the outer
 * transaction's, which every write of an install shares.
 */
const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

/** A skill's columns as a write returns them, its transaction beside them. */
const WRITTEN_SKILL_COLUMNS = { ...INSTALLED_SKILL_COLUMNS, ...TXID };

/** One file of an installed skill: its path from the skill's folder, such as `SKILL.md` or `scripts/run.sh`, and its bytes. */
export interface InstalledSkillFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** One installed skill with its files, in path order. */
export interface InstalledSkillWithFiles extends InstalledSkill {
  readonly files: readonly InstalledSkillFile[];
}

/** One installed skill as a read opens it: its `SKILL.md`'s bytes, and every file's path and size, in path order. */
export interface InstalledSkillRead extends InstalledSkill {
  readonly skillFile: Uint8Array;
  readonly files: readonly { readonly path: string; readonly bytes: number }[];
}

/** Whose a new skill is: the installer's own, or a workspace's they are a member of. */
export type InstalledSkillOwner =
  | { readonly scope: typeof INSTALLED_SKILL_SCOPE.PERSONAL }
  | { readonly scope: typeof INSTALLED_SKILL_SCOPE.WORKSPACE; readonly organizationId: string };

/** What installing a skill takes: whose it is, its name, what its `SKILL.md` says of it, where it came from, and every file. */
export interface NewInstalledSkill {
  readonly owner: InstalledSkillOwner;
  readonly name: string;
  readonly description: string;
  readonly userInvocable: boolean;
  readonly source: InstalledSkillSource;
  readonly files: readonly InstalledSkillFile[];
}

/** What an account asks to do with an installed skill: read and use it, or remove it. */
const INSTALLED_SKILL_ACCESS = {
  READ: "read",
  MANAGE: "manage",
} as const;

export type InstalledSkillAccess =
  (typeof INSTALLED_SKILL_ACCESS)[keyof typeof INSTALLED_SKILL_ACCESS];

/** The roles that manage a workspace's skills. */
const MANAGING_ROLES: readonly WorkspaceRole[] = [WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN];

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
    eq(installedSkill.ownerUserId, userId),
  );
}

/**
 * The condition that the account may do `access` with the skill a
 * statement names: its own personal skill, or a skill of a workspace it is
 * a current member of, which it manages where it installed it or is an
 * owner or admin there.
 */
function allowedTo(userId: string, access: InstalledSkillAccess, id?: string): SQL | undefined {
  const workspace = installedSkill.organizationId;
  const rule =
    access === INSTALLED_SKILL_ACCESS.MANAGE
      ? or(
          and(eq(installedSkill.installedByUserId, userId), memberOf(userId, workspace)),
          memberOf(userId, workspace, MANAGING_ROLES),
        )
      : memberOf(userId, workspace);
  return and(
    id === undefined ? undefined : eq(installedSkill.id, id),
    or(ownPersonal(userId), and(eq(installedSkill.scope, INSTALLED_SKILL_SCOPE.WORKSPACE), rule)),
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

/** Why the files may not be a skill's, or none where they may. */
function refusalOf(files: readonly InstalledSkillFile[]): Option.Option<InstalledSkillRefusal> {
  if (!files.some((file) => file.path === INSTALLED_SKILL_MAIN_FILE)) {
    return Option.some(INSTALLED_SKILL_REFUSAL.NO_SKILL_FILE);
  }
  if (holdsFileTooLarge(files.map((file) => file.bytes.byteLength))) {
    return Option.some(INSTALLED_SKILL_REFUSAL.TOO_LARGE);
  }
  return Option.none();
}

/** Nothing where the files may be a skill's, else the refusal of them. */
function checkedFiles(
  files: readonly InstalledSkillFile[],
): Effect.Effect<void, InstalledSkillFilesRefused> {
  return Option.match(refusalOf(files), {
    onNone: () => Effect.void,
    onSome: (reason) => Effect.fail(new InstalledSkillFilesRefused({ reason })),
  });
}

const findMembership = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId))),
    ),
});

const insertSkill = SqlSchema.findAll({
  Request: Schema.Struct({
    ownerUserId: Schema.NullOr(Schema.String),
    installedByUserId: Schema.String,
    organizationId: Schema.NullOr(Schema.String),
    scope: installedSkillScopeSchema,
    name: Schema.String,
    description: Schema.String,
    userInvocable: Schema.Boolean,
    source: installedSkillSourceSchema,
    now: Schema.Date,
  }),
  Result: WrittenSkillRowSchema,
  execute: ({ now, ...row }) =>
    Database.use((db) =>
      db
        .insert(installedSkill)
        .values({ ...row, createdAt: now, updatedAt: now })
        // Note that the conflict is a name held in its scope, by either partial index.
        .onConflictDoNothing()
        .returning(WRITTEN_SKILL_COLUMNS),
    ),
});

const insertFiles = SqlSchema.void({
  Request: Schema.Struct({
    skillId: Schema.String,
    files: Schema.Array(Schema.Struct({ path: Schema.String, bytes: Schema.Uint8Array })),
  }),
  execute: ({ skillId, files }) =>
    Database.use((db) =>
      db.insert(installedSkillFile).values(files.map((file) => ({ ...file, skillId }))),
    ),
});

/** A skill's row beside one of its files: a row per file, the skill's columns repeated on each. */
const SkillFileRowSchema = Schema.Struct({
  ...InstalledSkillRowSchema.fields,
  filePath: Schema.NullOr(Schema.String),
  fileBytes: Schema.NullOr(Schema.Uint8Array),
});

const SKILL_FILE_COLUMNS = {
  ...INSTALLED_SKILL_COLUMNS,
  filePath: installedSkillFile.path,
  fileBytes: installedSkillFile.bytes,
};

/** A skill's row beside one of its files' path and size, and the file's bytes where it is the skill's `SKILL.md`. */
const SkillFileSizeRowSchema = Schema.Struct({
  ...InstalledSkillRowSchema.fields,
  filePath: Schema.NullOr(Schema.String),
  fileSize: Schema.NullOr(Schema.Number),
  mainBytes: Schema.NullOr(Schema.Uint8Array),
});

const SKILL_FILE_SIZE_COLUMNS = {
  ...INSTALLED_SKILL_COLUMNS,
  filePath: installedSkillFile.path,
  fileSize: sql<number | null>`octet_length(${installedSkillFile.bytes})`,
  mainBytes: sql<Uint8Array | null>`case when ${installedSkillFile.path} = ${INSTALLED_SKILL_MAIN_FILE} then ${installedSkillFile.bytes} end`,
};

const accessSchema = Schema.Literals(Object.values(INSTALLED_SKILL_ACCESS));

/**
 * Note that a skill and its files are read in one statement, under the
 * rule that gates the skill, because two statements may each see another
 * committed state, such as a member's files read after they left. Only
 * `SKILL.md`'s bytes are read; every other file is read by its size.
 */
const findSkillWithFiles = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String, access: accessSchema }),
  Result: SkillFileSizeRowSchema,
  execute: ({ userId, id, access }) =>
    Database.use((db) =>
      db
        .select(SKILL_FILE_SIZE_COLUMNS)
        .from(installedSkill)
        .leftJoin(installedSkillFile, eq(installedSkillFile.skillId, installedSkill.id))
        .where(allowedTo(userId, access, id))
        .orderBy(asc(installedSkillFile.path)),
    ),
});

const findOffered = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: InstalledSkillRowSchema,
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select(INSTALLED_SKILL_COLUMNS)
        .from(installedSkill)
        .where(offeredIn(userId, organizationId))
        .orderBy(...OFFERED_ORDER),
    ),
});

const findOfferedWithFiles = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.NullOr(Schema.String) }),
  Result: SkillFileRowSchema,
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select(SKILL_FILE_COLUMNS)
        .from(installedSkill)
        .leftJoin(installedSkillFile, eq(installedSkillFile.skillId, installedSkill.id))
        .where(offeredIn(userId, organizationId))
        .orderBy(...OFFERED_ORDER, asc(installedSkill.id), asc(installedSkillFile.path)),
    ),
});

const removeSkill = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  Result: Schema.Struct({ txid: Schema.String }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .delete(installedSkill)
        .where(allowedTo(userId, INSTALLED_SKILL_ACCESS.MANAGE, id))
        .returning(TXID),
    ),
});

/** The skills of rows a file each, in the order read, each with its files. */
function groupedFiles(
  rows: readonly (typeof SkillFileRowSchema.Type)[],
): readonly InstalledSkillWithFiles[] {
  const skills = new Map<string, { skill: InstalledSkill; files: InstalledSkillFile[] }>();
  for (const { filePath, fileBytes, ...skill } of rows) {
    const held = skills.get(skill.id) ?? { skill, files: [] };
    if (filePath !== null && fileBytes !== null)
      held.files.push({ path: filePath, bytes: fileBytes });
    skills.set(skill.id, held);
  }
  return [...skills.values()].map(({ skill, files }) => ({ ...skill, files }));
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
  return findOffered({ userId, organizationId });
}

/** One skill the account may do `access` with, reading by default, with its `SKILL.md` and every file's size; nothing for any other id. */
export function readInstalledSkill(
  userId: string,
  id: string,
  access: InstalledSkillAccess = INSTALLED_SKILL_ACCESS.READ,
): TaskStoreEffect<Option.Option<InstalledSkillRead>> {
  return Effect.map(findSkillWithFiles({ userId, id, access }), (rows) => {
    const [first] = rows;
    if (first === undefined) return Option.none();
    const { filePath: _path, fileSize: _size, mainBytes: _main, ...skill } = first;
    const files = rows.flatMap((row) =>
      row.filePath === null || row.fileSize === null
        ? []
        : [{ path: row.filePath, bytes: row.fileSize }],
    );
    const main = rows.find((row) => row.mainBytes !== null)?.mainBytes ?? new Uint8Array();
    return Option.some({ ...skill, skillFile: main, files });
  });
}

/**
 * Installs the skill with its files in one transaction, answering
 * it with the transaction it committed in: nothing where the account may
 * not install in its scope (a workspace it is not a current member of),
 * `InstalledSkillNameTaken` where its scope holds the name already, and
 * `InstalledSkillFilesRefused` where its files break the bounds.
 */
export function installSkill(
  userId: string,
  made: NewInstalledSkill,
): Effect.Effect<
  Option.Option<WrittenSkill>,
  TaskStoreFailure | InstalledSkillNameTaken | InstalledSkillFilesRefused,
  DatabaseServices
> {
  return Effect.gen(function* () {
    yield* checkedFiles(made.files);
    const organizationId =
      made.owner.scope === INSTALLED_SKILL_SCOPE.WORKSPACE ? made.owner.organizationId : null;
    return yield* inTransaction(
      Effect.gen(function* () {
        if (organizationId !== null) {
          const membership = yield* findMembership({ userId, organizationId });
          if (membership.length === 0) return Option.none();
        }
        const now = yield* DateTime.nowAsDate;
        const [row] = yield* insertSkill({
          ownerUserId: organizationId === null ? userId : null,
          installedByUserId: userId,
          organizationId,
          scope: made.owner.scope,
          name: made.name,
          description: made.description,
          userInvocable: made.userInvocable,
          source: made.source,
          now,
        });
        if (row === undefined) return yield* new InstalledSkillNameTaken({ name: made.name });
        yield* insertFiles({ skillId: row.id, files: made.files });
        return Option.some(row);
      }),
    );
  });
}

/** Removes a skill the account may manage, and its files, answering the transaction it was removed in; nothing for any other id. */
export function removeInstalledSkill(
  userId: string,
  id: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(removeSkill({ userId, id }), (rows) =>
    Option.map(Option.fromUndefinedOr(rows[0]), (removed) => removed.txid),
  );
}

/**
 * The skills an agent the account starts is offered, with their
 * files, for its session: the workspace's, where it names one the account
 * is a current member of, then the account's own personal ones, each by
 * name. An agent on no workspace is offered the personal ones alone.
 */
export function sessionInstalledSkills(
  userId: string,
  organizationId: string | null,
): TaskStoreEffect<readonly InstalledSkillWithFiles[]> {
  return Effect.map(findOfferedWithFiles({ userId, organizationId }), groupedFiles);
}

/**
 * The skills the account sees in the workspace as its held read answers
 * them: the rows `listInstalledSkills` reads, each with whether the account
 * may manage it, by the store's own rule (`allowedTo`), and the workspace a
 * workspace skill is, null for a personal one. Every column is under the key
 * the wire reads it by (`@repo/features/installed-skill-live`), each instant
 * as epoch milliseconds, and the order is the reader's to keep. None where a
 * statement names a value Realtime cannot carry.
 */
export function installedSkillsLiveStatement(
  userId: string,
  organizationId: string,
): Option.Option<LiveStatement> {
  // Note that a skill whose installer's account is gone compares as unknown, so it reads manageable only by those who manage the workspace.
  const manageable = sql<boolean>`coalesce(${allowedTo(userId, INSTALLED_SKILL_ACCESS.MANAGE)}, false)`;
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            id: installedSkill.id,
            scope: installedSkill.scope,
            name: installedSkill.name,
            description: installedSkill.description,
            userInvocable: installedSkill.userInvocable,
            source: installedSkill.source,
            // Note that every skill is on, and a desktop released before the switch went still reads it.
            enabled: sql<boolean>`true`,
            workspaceId: installedSkill.organizationId,
            installedBy: installedSkill.installedByUserId,
            manageable,
          },
          { createdAt: installedSkill.createdAt, updatedAt: installedSkill.updatedAt },
        ),
      )
      .from(installedSkill)
      .where(offeredIn(userId, organizationId)),
  );
}
