import { createHash } from "node:crypto";
import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, type ParseResult, Schema } from "effect";

/**
 * What a turn ran under, addressed by the SHA-256 of the bytes as the model
 * was offered them, so a thousand turns under one prompt or one tool set
 * carry one hash and a changed workspace file or a reworded tool is a new
 * hash on the next turn that runs under it. The hash is taken over exactly
 * what was offered, never over a normalized form: the schemas' key order is
 * part of what a model reads, and the goldens hold it still for the same
 * reason. The two are kept differently. The prompt is the developer's words,
 * embedding their workspace rows whole, so nothing of it is stored but its
 * fingerprint on the turn; the tool set is the build's own, identical for
 * every account and carrying nothing of anyone's, so it is stored whole,
 * once, under its hash.
 */

/** One tool as the model is offered it: the name, the words, and the JSON Schema of its input. */
export interface OfferedToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The content address of a prompt: the hash of its text, and the whole of what the record keeps of it. */
export function promptHashOf(text: string): string {
  return sha256Hex(text);
}

/** The content address of a tool set: the hash of the offered declarations serialized in their offered order. */
export function toolSetHashOf(schemas: readonly OfferedToolSchema[]): string {
  return sha256Hex(JSON.stringify(schemas));
}

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const RecordToolSetSchema = Schema.Struct({
  hash: Schema.String,
  schemas: Schema.String,
  createdAt: Schema.DateFromSelf,
});

const insertToolSet = SqlSchema.void({
  Request: RecordToolSetSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into tool_sets (hash, schemas, created_at)
        values (${write.hash}, ${write.schemas}::jsonb, ${write.createdAt})
        on conflict (hash) do nothing
      `,
    ),
});

/** Writes the tool set where no row stands for its hash; answers the hash either way. */
export function recordToolSet(
  schemas: readonly OfferedToolSchema[],
  now: Date,
): Effect.Effect<string, SqlError | ParseResult.ParseError, SqlClient.SqlClient> {
  const hash = toolSetHashOf(schemas);
  return Effect.as(insertToolSet({ hash, schemas: JSON.stringify(schemas), createdAt: now }), hash);
}
