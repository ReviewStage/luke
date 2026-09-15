import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { DAILY_NOTES_DIRECTORY } from "../../core.js";
import { EpochMillisColumnSchema } from "./database.js";

/**
 * The identity workspace and the notebook, one row per user per file. A path
 * is workspace-relative and plain — no leading slash, no empty or `..`
 * segment — so a row can never name a file outside the workspace; the
 * contents are stored in the clear, written whole and rewritten whole, the
 * way the desktop's workspace files land through a rename.
 *
 * The first module here on `effect/unstable/sql`: every read and write below is an
 * `Effect<A, SqlError | SchemaError, SqlClient>`, the statement is the client's
 * own tagged template, and the row a statement answers is decoded by a
 * `Schema` rather than trusted. The rule about a path is that schema too, so
 * one declaration both refuses the path and names the refusal.
 */

/**
 * How a statement here fails: the driver's own refusal, or a row or a path the
 * schema refused, which is what puts the path rule in the same channel as the
 * database's own answer.
 */
type WorkspaceFileFailure = SqlError | Schema.SchemaError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const PATH_SEPARATOR = "/";

/**
 * A workspace-relative path, refused where it could name a file outside the
 * workspace. Every statement below takes its path through this schema, so the
 * refusal is the same wherever a path arrives and no query is prepared for one.
 */
const WorkspacePathSchema = Schema.String.check(
  Schema.makeFilter((path) =>
    path.length > 0 &&
    !path.startsWith(PATH_SEPARATOR) &&
    !path.includes("\\") &&
    path
      .split(PATH_SEPARATOR)
      .every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
      ? undefined
      : "a workspace path is relative and names no parent",
  ),
);

const FileKeySchema = Schema.Struct({
  userId: Schema.String,
  path: WorkspacePathSchema,
});

const FileWriteSchema = Schema.Struct({
  userId: Schema.String,
  path: WorkspacePathSchema,
  content: Schema.String,
  now: Schema.Number,
});

/** The dated notes' prefix, the one prefix a listing is asked under. */
const DAILY_NOTES_PREFIX = `${DAILY_NOTES_DIRECTORY}/`;

const DailyNotesRequestSchema = Schema.Struct({
  userId: Schema.String,
  limit: Schema.Number,
});

/** A dated note's row as the listing reads it: its path and its contents, read only to be counted. */
const DailyNoteRowSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
});

/** The row as `workspace_file` holds it. */
const WorkspaceFileRowSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  createdAt: EpochMillisColumnSchema,
  updatedAt: EpochMillisColumnSchema,
}).pipe(
  Schema.encodeKeys({
    createdAt: "created_at",
    updatedAt: "updated_at",
  }),
);

/** What a listing row carries: the path and when it last changed, never a word of the file. */
const WorkspaceFileListingSchema = Schema.Struct({
  path: Schema.String,
  updatedAt: EpochMillisColumnSchema,
}).pipe(Schema.encodeKeys({ updatedAt: "updated_at" }));

/** The path a write landed on, which is how a conditional write answers whether it did. */
const WrittenPathSchema = Schema.Struct({ path: Schema.String });

export type WorkspaceFileListing = Schema.Schema.Type<typeof WorkspaceFileListingSchema>;

/** One dated note as the listing answers it: its path and how many characters it holds, never a word of it. */
export interface DailyNoteRecord {
  readonly path: string;
  readonly chars: number;
}

export interface WorkspaceFileRecord {
  readonly path: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const findFile = SqlSchema.findOneOption({
  Request: FileKeySchema,
  Result: WorkspaceFileRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select path, content, created_at, updated_at
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
        insert into workspace_file (user_id, path, content, created_at, updated_at)
        values (${write.userId}, ${write.path}, ${write.content}, ${write.now}, ${write.now})
        on conflict (user_id, path) do update
          set content = excluded.content, updated_at = excluded.updated_at
      `,
    ),
});

const insertFile = SqlSchema.findAll({
  Request: FileWriteSchema,
  Result: WrittenPathSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into workspace_file (user_id, path, content, created_at, updated_at)
        values (${write.userId}, ${write.path}, ${write.content}, ${write.now}, ${write.now})
        on conflict (user_id, path) do nothing
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

/**
 * The dated notes newest first, which is their paths in descending byte
 * order since a note is named by its day; the collation is fixed so the two
 * dialects the tests run over, and a deployment's own, order one way.
 */
const findDailyNotes = SqlSchema.findAll({
  Request: DailyNotesRequestSchema,
  Result: DailyNoteRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select path, content
        from workspace_file
        where user_id = ${request.userId} and starts_with(path, ${DAILY_NOTES_PREFIX})
        order by path collate "C" desc
        limit ${request.limit}
      `,
    ),
});

/** Takes the user's row lock for the transaction, so two revisions of one account's files run one after the other. */
const lockUser = (userId: string) =>
  statement((sql) => sql`select id from "user" where id = ${userId} for update`);

export function readWorkspaceFile(
  userId: string,
  path: string,
): Effect.Effect<Option.Option<WorkspaceFileRecord>, WorkspaceFileFailure, SqlClient.SqlClient> {
  return Effect.map(
    findFile({ userId, path }),
    Option.map((row) => ({
      path: row.path,
      content: row.content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  );
}

/** Writes the file whole, creating it or replacing it. */
export function writeWorkspaceFile(
  userId: string,
  path: string,
  content: string,
  now: number,
): Effect.Effect<void, WorkspaceFileFailure, SqlClient.SqlClient> {
  return upsertFile({ userId, path, content, now });
}

/**
 * Rewrites the file from what stands, under the account's row lock, so two
 * revisions in flight for one account read and write one after the other
 * and neither loses the other's words. The revision answers the new content,
 * or nothing to leave the file exactly as it was; what is answered here is
 * what landed, or nothing where the revision declined.
 */
export function reviseWorkspaceFile(
  userId: string,
  path: string,
  revise: (existing: string | undefined) => string | undefined,
  now: number,
): Effect.Effect<string | undefined, WorkspaceFileFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* lockUser(userId);
        const standing = yield* readWorkspaceFile(userId, path);
        const revised = revise(Option.getOrUndefined(standing)?.content);
        if (revised === undefined) return undefined;
        yield* upsertFile({ userId, path, content: revised, now });
        return revised;
      }),
    ),
  );
}

/** Writes the file only where none stands: the seeding a launch does once, and an edit never undone by an upgrade. */
export function seedWorkspaceFile(
  userId: string,
  path: string,
  content: string,
  now: number,
): Effect.Effect<boolean, WorkspaceFileFailure, SqlClient.SqlClient> {
  return Effect.map(insertFile({ userId, path, content, now }), (written) => written.length > 0);
}

export function listWorkspaceFiles(
  userId: string,
): Effect.Effect<readonly WorkspaceFileListing[], WorkspaceFileFailure, SqlClient.SqlClient> {
  return findFiles(userId);
}

/** The user's dated notes under `memory/`, newest first and at most `limit` of them, each read only to count its characters. */
export function listDailyNotes(
  userId: string,
  limit: number,
): Effect.Effect<readonly DailyNoteRecord[], WorkspaceFileFailure, SqlClient.SqlClient> {
  return Effect.map(findDailyNotes({ userId, limit }), (rows) =>
    rows.map((row) => ({ path: row.path, chars: row.content.length })),
  );
}
