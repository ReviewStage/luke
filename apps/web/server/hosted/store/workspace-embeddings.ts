import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";

/**
 * The embedding cache behind the notebook's search: one row per user per
 * passage hash, holding the numeric vector OpenAI's embeddings model answered
 * for the passage and the model it was answered under, and never a word of
 * the passage. The passage's words stand only in `workspace_file`;
 * the hash here is SHA-256 of them, which names the passage to a search that
 * has just cut the same words again and identifies nothing to anyone else.
 * A search fills the cache lazily for the passages it finds unembedded and
 * drops the rows of passages no file holds any more, so the table follows the
 * workspace rather than growing with its history.
 *
 * Every statement is an `Effect<A, SqlError | SchemaError, SqlClient>` over the
 * ambient client, the way `workspace-files.ts` reads. The vector travels as
 * JSON text cast to `jsonb` on the way in and is decoded as a number array on
 * the way out, because a `jsonb` column answers a parsed value on both
 * dialects the store's tests stand over.
 */

type WorkspaceEmbeddingFailure = SqlError | Schema.SchemaError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

export interface WorkspaceEmbeddingWrite {
  readonly hash: string;
  readonly vector: readonly number[];
}

const EmbeddingRowSchema = Schema.Struct({
  hash: Schema.String,
  embedding: Schema.Array(Schema.Number),
});

const ReadEmbeddingsSchema = Schema.Struct({
  userId: Schema.String,
  model: Schema.String,
  hashes: Schema.Array(Schema.String),
});

const WriteEmbeddingSchema = Schema.Struct({
  userId: Schema.String,
  hash: Schema.String,
  model: Schema.String,
  /** The vector as JSON text, cast to `jsonb` in the statement. */
  embedding: Schema.String,
  createdAt: Schema.Number,
});

const PruneSchema = Schema.Struct({
  userId: Schema.String,
  hashes: Schema.Array(Schema.String),
});

const PrunedRowSchema = Schema.Struct({ hash: Schema.String });

const findEmbeddings = SqlSchema.findAll({
  Request: ReadEmbeddingsSchema,
  Result: EmbeddingRowSchema,
  execute: (read) =>
    statement(
      (sql) => sql`
        select hash, embedding
        from workspace_embedding
        where user_id = ${read.userId}
          and model = ${read.model}
          and ${sql.in("hash", read.hashes)}
      `,
    ),
});

const upsertEmbedding = SqlSchema.void({
  Request: WriteEmbeddingSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into workspace_embedding (user_id, hash, model, embedding, created_at)
        values (${write.userId}, ${write.hash}, ${write.model}, ${write.embedding}::jsonb, ${write.createdAt})
        on conflict (user_id, hash) do update
          set model = excluded.model, embedding = excluded.embedding, created_at = excluded.created_at
      `,
    ),
});

const pruneEmbeddings = SqlSchema.findAll({
  Request: PruneSchema,
  Result: PrunedRowSchema,
  execute: (prune) =>
    statement(
      (sql) => sql`
        delete from workspace_embedding
        where user_id = ${prune.userId}
          ${prune.hashes.length === 0 ? sql`` : sql`and hash not in ${sql.in(prune.hashes)}`}
        returning hash
      `,
    ),
});

/** The cached vectors among the hashes given, under the model named; a hash embedded under another model, or never, is absent. */
export function readWorkspaceEmbeddings(
  userId: string,
  model: string,
  hashes: readonly string[],
): Effect.Effect<
  ReadonlyMap<string, readonly number[]>,
  WorkspaceEmbeddingFailure,
  SqlClient.SqlClient
> {
  if (hashes.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findEmbeddings({ userId, model, hashes }),
    (rows) => new Map(rows.map((row) => [row.hash, row.embedding])),
  );
}

/** Caches each vector under its hash, replacing one cached under another model. */
export function writeWorkspaceEmbeddings(
  userId: string,
  model: string,
  writes: readonly WorkspaceEmbeddingWrite[],
  now: number,
): Effect.Effect<void, WorkspaceEmbeddingFailure, SqlClient.SqlClient> {
  return Effect.forEach(
    writes,
    (write) =>
      upsertEmbedding({
        userId,
        hash: write.hash,
        model,
        embedding: JSON.stringify(write.vector),
        createdAt: now,
      }),
    { discard: true },
  );
}

/** Drops every cached vector of the account whose hash is not among the passages standing now; answers how many went. */
export function pruneWorkspaceEmbeddings(
  userId: string,
  hashes: readonly string[],
): Effect.Effect<number, WorkspaceEmbeddingFailure, SqlClient.SqlClient> {
  return Effect.map(pruneEmbeddings({ userId, hashes }), (rows) => rows.length);
}
