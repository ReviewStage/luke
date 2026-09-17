import { and, asc, eq, or, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { DAILY_NOTES_DIRECTORY, parseDailyNoteName } from "../../core.js";
import { user } from "../../db/auth-schema.js";
import { db } from "../../db/query.js";
import { workspaceFile } from "../../db/workspace-schema.js";
import { EpochMillisColumnSchema } from "./database.js";

/**
 * The identity workspace and the notebook, one row per user per file. A path
 * is workspace-relative and plain — no leading slash, no empty or `..`
 * segment — so a row can never name a file outside the workspace; the
 * contents are stored in the clear, written whole and rewritten whole, the
 * way the desktop's workspace files land through a rename.
 *
 * The first module here on the Drizzle query builder, and the shape the rest
 * are converted into. Every read and write below is still an
 * `Effect<A, SqlError | SchemaError, SqlClient>`: the statement is a builder
 * over the table `db/workspace-schema.ts` declares, yielded as the Effect the
 * bridge (`db/drizzle.ts`) made it, which runs it on the `SqlClient` the
 * asking fiber already carries. Four things follow from that, each a decision
 * the next module copies:
 *
 * - The handle is the shared `db`, imported and never built here, and the
 *   tables are named imports from their own schema module, so a column
 *   renamed under `db/` is a type error here rather than a statement that
 *   still parses.
 * - A row is still decoded by a `Schema` rather than trusted: the builder
 *   hands back the statement's rows, not a guarantee about them, and
 *   `EpochMillisColumnSchema` is still what reconciles `pg` reading an
 *   `int8` as a string against PGlite reading it as a number. What the
 *   builder does remove is the wire-key mapping — a projection names its own
 *   fields, so the result schema is spelled in the same words the rest of the
 *   module is and no `Schema.encodeKeys` stands between them.
 * - Where Postgres has something the builder cannot spell, the fragment is
 *   Drizzle's own `sql` inside the builder — still one rendered statement
 *   with its parameters bound by Drizzle — and it is named as a constant, so
 *   the query reads as the query it is.
 * - A transaction and a row lock are unchanged: the ambient client's own
 *   `withTransaction`, and the lock a `.for("update")` select inside it. The
 *   bridge reads the client from the running fiber, which is what puts a
 *   bridged statement inside the transaction rather than beside it.
 *
 * The rule about a path is a `Schema` too, so one declaration both refuses
 * the path and names the refusal, and no builder is ever rendered for one.
 */

/**
 * How a statement here fails: the driver's own refusal, or a row or a path the
 * schema refused, which is what puts the path rule in the same channel as the
 * database's own answer.
 */
type WorkspaceFileFailure = SqlError | Schema.SchemaError;

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

/** The dated notes and nothing else, which is the one predicate the builder has no operator for. */
const UNDER_DAILY_NOTES = sql`starts_with(${workspaceFile.path}, ${DAILY_NOTES_PREFIX})`;

/**
 * The dated notes newest first, which is their paths in descending byte
 * order since a note is named by its day; the collation is fixed so the two
 * dialects the tests run over, and a deployment's own, order one way. There
 * is no builder spelling for a collation, so the ordering is a fragment.
 */
const NEWEST_DAY_FIRST = sql`${workspaceFile.path} collate "C" desc`;

const DailyNotesRequestSchema = Schema.Struct({
  userId: Schema.String,
  limit: Schema.Number,
});

const DailyNotesForDaysRequestSchema = Schema.Struct({
  userId: Schema.String,
  days: Schema.Array(Schema.String),
});

/** A dated note's row as the listing reads it: its path and its contents, read only to be counted. */
const DailyNoteRowSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
});

/** The row as `workspace_file` holds it, in the fields the projection below names. */
const WorkspaceFileRowSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  createdAt: EpochMillisColumnSchema,
  updatedAt: EpochMillisColumnSchema,
});

/** What a listing row carries: the path and when it last changed, never a word of the file. */
const WorkspaceFileListingSchema = Schema.Struct({
  path: Schema.String,
  updatedAt: EpochMillisColumnSchema,
});

/** The path a write landed on, which is how a conditional write answers whether it did. */
const WrittenPathSchema = Schema.Struct({ path: Schema.String });

export type WorkspaceFileListing = Schema.Schema.Type<typeof WorkspaceFileListingSchema>;

/** One dated note as the listing answers it: its path and how many characters it holds, never a word of it. */
export interface DailyNoteRecord {
  readonly path: string;
  readonly chars: number;
}

/** A dated note read whole: its path and its words. */
export interface DailyNoteRow {
  readonly path: string;
  readonly content: string;
}

export interface WorkspaceFileRecord {
  readonly path: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** The whole row of one file, keyed by the account it belongs to and its path. */
const findFile = SqlSchema.findOneOption({
  Request: FileKeySchema,
  Result: WorkspaceFileRowSchema,
  execute: (key) =>
    db
      .select({
        path: workspaceFile.path,
        content: workspaceFile.content,
        createdAt: workspaceFile.createdAt,
        updatedAt: workspaceFile.updatedAt,
      })
      .from(workspaceFile)
      .where(and(eq(workspaceFile.userId, key.userId), eq(workspaceFile.path, key.path))),
});

/**
 * Note that the conflicting update sets the values the insert carried rather
 * than reading them back out of `excluded`, because a single-row insert's
 * `excluded` row is exactly those values and naming the columns in SQL text
 * is what a renamed column would slip through.
 */
const upsertFile = SqlSchema.void({
  Request: FileWriteSchema,
  execute: (write) =>
    db
      .insert(workspaceFile)
      .values({
        userId: write.userId,
        path: write.path,
        content: write.content,
        createdAt: write.now,
        updatedAt: write.now,
      })
      .onConflictDoUpdate({
        target: [workspaceFile.userId, workspaceFile.path],
        set: { content: write.content, updatedAt: write.now },
      }),
});

const insertFile = SqlSchema.findAll({
  Request: FileWriteSchema,
  Result: WrittenPathSchema,
  execute: (write) =>
    db
      .insert(workspaceFile)
      .values({
        userId: write.userId,
        path: write.path,
        content: write.content,
        createdAt: write.now,
        updatedAt: write.now,
      })
      .onConflictDoNothing({ target: [workspaceFile.userId, workspaceFile.path] })
      .returning({ path: workspaceFile.path }),
});

const findFiles = SqlSchema.findAll({
  Request: Schema.String,
  Result: WorkspaceFileListingSchema,
  execute: (userId) =>
    db
      .select({ path: workspaceFile.path, updatedAt: workspaceFile.updatedAt })
      .from(workspaceFile)
      .where(eq(workspaceFile.userId, userId))
      .orderBy(asc(workspaceFile.path)),
});

const findDailyNotes = SqlSchema.findAll({
  Request: DailyNotesRequestSchema,
  Result: DailyNoteRowSchema,
  execute: (request) =>
    db
      .select({ path: workspaceFile.path, content: workspaceFile.content })
      .from(workspaceFile)
      .where(and(eq(workspaceFile.userId, request.userId), UNDER_DAILY_NOTES))
      .orderBy(NEWEST_DAY_FIRST)
      .limit(request.limit),
});

/**
 * The dated notes for the given days, slugged variants included, in path
 * order: a note is named by its day, so each day is one prefix under
 * `memory/`, and the name is still parsed on the way out because a prefix
 * cannot say where the day ends.
 */
const findDailyNotesForDays = SqlSchema.findAll({
  Request: DailyNotesForDaysRequestSchema,
  Result: DailyNoteRowSchema,
  execute: (request) =>
    db
      .select({ path: workspaceFile.path, content: workspaceFile.content })
      .from(workspaceFile)
      .where(
        and(
          eq(workspaceFile.userId, request.userId),
          or(
            ...request.days.map(
              (day) => sql`starts_with(${workspaceFile.path}, ${`${DAILY_NOTES_PREFIX}${day}`})`,
            ),
          ),
        ),
      )
      .orderBy(asc(workspaceFile.path)),
});

/** Takes the user's row lock for the transaction, so two revisions of one account's files run one after the other. */
const lockUser = (userId: string) =>
  db.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");

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
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
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

/** The user's dated notes for the given days, slugged variants included and in path order, words and all. */
export function readDailyNotesForDays(
  userId: string,
  days: readonly string[],
): Effect.Effect<readonly DailyNoteRow[], WorkspaceFileFailure, SqlClient.SqlClient> {
  if (days.length === 0) return Effect.succeed([]);
  return Effect.map(findDailyNotesForDays({ userId, days }), (rows) =>
    rows.filter((row) => {
      const parsed = parseDailyNoteName(row.path.slice(DAILY_NOTES_PREFIX.length));
      return parsed !== undefined && days.includes(parsed.day);
    }),
  );
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
