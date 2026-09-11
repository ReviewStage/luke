import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import { EpochMillisColumnSchema, type UserSeal } from "./database.js";

/**
 * The identity workspace and the notebook, one row per user per file. A path
 * is workspace-relative and plain — no leading slash, no empty or `..`
 * segment — so a row can never name a file outside the workspace; the
 * contents are sealed whole and rewritten whole, the way the desktop's
 * workspace files land through a rename.
 *
 * The first module here on `@effect/sql`: every read and write below is an
 * `Effect<A, SqlError | ParseError, SqlClient>`, the statement is the client's
 * own tagged template, and the row a statement answers is decoded by a
 * `Schema` rather than trusted. The rule about a path is that schema too, so
 * one declaration both refuses the path and names the refusal.
 */

/**
 * How a statement here fails: the driver's own refusal, or a row or a path the
 * schema refused, which is what puts the path rule in the same channel as the
 * database's own answer.
 */
type WorkspaceFileFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const PATH_SEPARATOR = "/";

/**
 * A workspace-relative path, refused where it could name a file outside the
 * workspace. Every statement below takes its path through this schema, so the
 * refusal is the same wherever a path arrives and no query is prepared for one.
 */
const WorkspacePathSchema = Schema.String.pipe(
  Schema.filter(
    (path) =>
      path.length > 0 &&
      !path.startsWith(PATH_SEPARATOR) &&
      !path.includes("\\") &&
      path
        .split(PATH_SEPARATOR)
        .every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    { message: () => "a workspace path is relative and names no parent" },
  ),
);

const FileKeySchema = Schema.Struct({
  userId: Schema.String,
  path: WorkspacePathSchema,
});

const FileWriteSchema = Schema.Struct({
  userId: Schema.String,
  path: WorkspacePathSchema,
  sealedContent: Schema.String,
  now: Schema.Number,
});

/** The row as `workspace_file` holds it, contents still sealed. */
const SealedWorkspaceFileSchema = Schema.Struct({
  path: Schema.String,
  sealedContent: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("sealed_content")),
  createdAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(Schema.fromKey("created_at")),
  updatedAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(Schema.fromKey("updated_at")),
});

/** What a listing row carries: the path and when it last changed, never a word of the file. */
const WorkspaceFileListingSchema = Schema.Struct({
  path: Schema.String,
  updatedAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(Schema.fromKey("updated_at")),
});

/** The path a write landed on, which is how a conditional write answers whether it did. */
const WrittenPathSchema = Schema.Struct({ path: Schema.String });

export type WorkspaceFileListing = Schema.Schema.Type<typeof WorkspaceFileListingSchema>;

export interface WorkspaceFileRecord {
  readonly path: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const findFile = SqlSchema.findOne({
  Request: FileKeySchema,
  Result: SealedWorkspaceFileSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select path, sealed_content, created_at, updated_at
        from workspace_file
        where user_id = ${key.userId} and path = ${key.path}
      `,
    ),
});

const upsertFile = SqlSchema.void({
  Request: FileWriteSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into workspace_file (user_id, path, sealed_content, created_at, updated_at)
        values (${write.userId}, ${write.path}, ${write.sealedContent}, ${write.now}, ${write.now})
        on conflict (user_id, path) do update
          set sealed_content = excluded.sealed_content, updated_at = excluded.updated_at
      `,
    ),
});

const insertFile = SqlSchema.findAll({
  Request: FileWriteSchema,
  Result: WrittenPathSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into workspace_file (user_id, path, sealed_content, created_at, updated_at)
        values (${write.userId}, ${write.path}, ${write.sealedContent}, ${write.now}, ${write.now})
        on conflict (user_id, path) do nothing
        returning path
      `,
    ),
});

const removeFile = SqlSchema.findAll({
  Request: FileKeySchema,
  Result: WrittenPathSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        delete from workspace_file
        where user_id = ${key.userId} and path = ${key.path}
        returning path
      `,
    ),
});

const findFiles = SqlSchema.findAll({
  Request: Schema.String,
  Result: WorkspaceFileListingSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select path, updated_at
        from workspace_file
        where user_id = ${userId}
        order by path asc
      `,
    ),
});

export function readWorkspaceFile(
  seal: UserSeal,
  userId: string,
  path: string,
): Effect.Effect<Option.Option<WorkspaceFileRecord>, WorkspaceFileFailure, SqlClient.SqlClient> {
  return Effect.map(
    findFile({ userId, path }),
    Option.map((row) => ({
      path: row.path,
      content: seal.open(row.sealedContent),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  );
}

/** Writes the file whole, creating it or replacing it. */
export function writeWorkspaceFile(
  seal: UserSeal,
  userId: string,
  path: string,
  content: string,
  now: number,
): Effect.Effect<void, WorkspaceFileFailure, SqlClient.SqlClient> {
  return upsertFile({ userId, path, sealedContent: seal.seal(content), now });
}

/** Writes the file only where none stands: the seeding a launch does once, and an edit never undone by an upgrade. */
export function seedWorkspaceFile(
  seal: UserSeal,
  userId: string,
  path: string,
  content: string,
  now: number,
): Effect.Effect<boolean, WorkspaceFileFailure, SqlClient.SqlClient> {
  return Effect.map(
    insertFile({ userId, path, sealedContent: seal.seal(content), now }),
    (written) => written.length > 0,
  );
}

export function deleteWorkspaceFile(
  userId: string,
  path: string,
): Effect.Effect<boolean, WorkspaceFileFailure, SqlClient.SqlClient> {
  return Effect.map(removeFile({ userId, path }), (removed) => removed.length > 0);
}

export function listWorkspaceFiles(
  userId: string,
): Effect.Effect<readonly WorkspaceFileListing[], WorkspaceFileFailure, SqlClient.SqlClient> {
  return findFiles(userId);
}
