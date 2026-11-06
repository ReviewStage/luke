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

export class InstalledSkillNameTaken extends Data.TaggedError("InstalledSkillNameTaken")<{
  readonly name: string;
}> {}

export class InstalledSkillFilesRefused extends Data.TaggedError("InstalledSkillFilesRefused")<{
  readonly reason: InstalledSkillRefusal;
}> {}

const InstalledSkillRowSchema = Schema.Struct({
  id: Schema.String,
  ownerUserId: Schema.NullOr(Schema.String),
  installedByUserId: Schema.NullOr(Schema.String),
  organizationId: Schema.NullOr(Schema.String),
  scope: installedSkillScopeSchema,
  name: Schema.String,
  description: Schema.String,
  userInvocable: Schema.Boolean,
  source: installedSkillSourceSchema,
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

export type InstalledSkill = typeof InstalledSkillRowSchema.Type;

const WrittenSkillRowSchema = Schema.Struct({
  ...InstalledSkillRowSchema.fields,
  txid: Schema.String,
});

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

const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

const WRITTEN_SKILL_COLUMNS = { ...INSTALLED_SKILL_COLUMNS, ...TXID };

export interface InstalledSkillFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface InstalledSkillWithFiles extends InstalledSkill {
  readonly files: readonly InstalledSkillFile[];
}

export interface InstalledSkillRead extends InstalledSkill {
  readonly skillFile: Uint8Array;
  readonly files: readonly { readonly path: string; readonly bytes: number }[];
}

export type InstalledSkillOwner =
  | { readonly scope: typeof INSTALLED_SKILL_SCOPE.PERSONAL }
  | { readonly scope: typeof INSTALLED_SKILL_SCOPE.WORKSPACE; readonly organizationId: string };

export interface NewInstalledSkill {
  readonly owner: InstalledSkillOwner;
  readonly name: string;
  readonly description: string;
  readonly userInvocable: boolean;
  readonly source: InstalledSkillSource;
  readonly files: readonly InstalledSkillFile[];
}

const INSTALLED_SKILL_ACCESS = {
  READ: "read",
  MANAGE: "manage",
} as const;

export type InstalledSkillAccess =
  (typeof INSTALLED_SKILL_ACCESS)[keyof typeof INSTALLED_SKILL_ACCESS];

const MANAGING_ROLES: readonly WorkspaceRole[] = [WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN];

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

function ownPersonal(userId: string): SQL | undefined {
  return and(
    eq(installedSkill.scope, INSTALLED_SKILL_SCOPE.PERSONAL),
    eq(installedSkill.ownerUserId, userId),
  );
}

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

const OFFERED_ORDER = [
  sql`case when ${installedSkill.scope} = ${INSTALLED_SKILL_SCOPE.WORKSPACE} then 0 else 1 end`,
  asc(installedSkill.name),
];

function refusalOf(files: readonly InstalledSkillFile[]): Option.Option<InstalledSkillRefusal> {
  if (!files.some((file) => file.path === INSTALLED_SKILL_MAIN_FILE)) {
    return Option.some(INSTALLED_SKILL_REFUSAL.NO_SKILL_FILE);
  }
  if (holdsFileTooLarge(files.map((file) => file.bytes.byteLength))) {
    return Option.some(INSTALLED_SKILL_REFUSAL.TOO_LARGE);
  }
  return Option.none();
}

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

function inTransaction<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | TaskStoreFailure, R | DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(effect));
}

export function listInstalledSkills(
  userId: string,
  organizationId: string,
): TaskStoreEffect<readonly InstalledSkill[]> {
  return findOffered({ userId, organizationId });
}

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

export function removeInstalledSkill(
  userId: string,
  id: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(removeSkill({ userId, id }), (rows) =>
    Option.map(Option.fromUndefinedOr(rows[0]), (removed) => removed.txid),
  );
}

export function sessionInstalledSkills(
  userId: string,
  organizationId: string | null,
): TaskStoreEffect<readonly InstalledSkillWithFiles[]> {
  return Effect.map(findOfferedWithFiles({ userId, organizationId }), groupedFiles);
}

export function installedSkillsLiveStatement(
  userId: string,
  organizationId: string,
): Option.Option<LiveStatement> {
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
