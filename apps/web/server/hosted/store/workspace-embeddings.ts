import { and, eq, inArray, notInArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../../db/query.js";
import { workspaceEmbedding } from "../../db/workspace-schema.js";

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
 * ambient client, the way `workspace-files.ts` reads: a Drizzle builder over
 * the table `db/workspace-schema.ts` declares, yielded as the Effect the
 * bridge made it. The vector is the `jsonb` column's own value — the builder
 * renders it to JSON on the way in and answers a parsed value on both
 * dialects the store's tests stand over — and is decoded as a number array
 * rather than trusted.
 */

type WorkspaceEmbeddingFailure = SqlError | Schema.SchemaError;

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
  embedding: Schema.Array(Schema.Number),
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
    db
      .select({ hash: workspaceEmbedding.hash, embedding: workspaceEmbedding.embedding })
      .from(workspaceEmbedding)
      .where(
        and(
          eq(workspaceEmbedding.userId, read.userId),
          eq(workspaceEmbedding.model, read.model),
          inArray(workspaceEmbedding.hash, [...read.hashes]),
        ),
      ),
});

/**
 * Note that the conflicting update sets the values the insert carried rather
 * than reading them back out of `excluded`, because a single-row insert's
 * `excluded` row is exactly those values.
 */
const upsertEmbedding = SqlSchema.void({
  Request: WriteEmbeddingSchema,
  execute: (write) =>
    db
      .insert(workspaceEmbedding)
      .values({
        userId: write.userId,
        hash: write.hash,
        model: write.model,
        embedding: write.embedding,
        createdAt: write.createdAt,
      })
      .onConflictDoUpdate({
        target: [workspaceEmbedding.userId, workspaceEmbedding.hash],
        set: {
          model: write.model,
          embedding: write.embedding,
          createdAt: write.createdAt,
        },
      }),
});

/** An account whose passages are all gone keeps no vector, so no hash to spare is no predicate rather than an empty one. */
const pruneEmbeddings = SqlSchema.findAll({
  Request: PruneSchema,
  Result: PrunedRowSchema,
  execute: (prune) =>
    db
      .delete(workspaceEmbedding)
      .where(
        and(
          eq(workspaceEmbedding.userId, prune.userId),
          prune.hashes.length === 0
            ? undefined
            : notInArray(workspaceEmbedding.hash, [...prune.hashes]),
        ),
      )
      .returning({ hash: workspaceEmbedding.hash }),
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
        embedding: write.vector,
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
