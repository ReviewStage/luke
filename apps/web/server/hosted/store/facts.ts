import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, type ParseResult, Schema } from "effect";
import { EpochMillisColumnSchema, type UserSeal } from "./database.js";

/**
 * The durable facts Luke keeps about the developer, listed in the order they
 * were remembered and replaced whole, so a changed fact takes the place of
 * the one it corrects and a forgotten one is simply absent from the next
 * list. The words are sealed; the id is what a request to forget names.
 *
 * Every statement below is an `Effect<A, SqlError | ParseError, SqlClient>`
 * over the ambient client, the way `workspace-files.ts` reads; the row lock
 * a replacement takes is a statement like any other, run inside the one
 * `withTransaction` that also holds the delete and the inserts that follow it.
 */

/** How a statement here fails: the driver's own refusal, or a row this build cannot decode. */
export type FactsFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E, R = never>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

export interface StoredFact {
  readonly id: string;
  readonly words: string;
  readonly createdAt: number;
}

export interface FactWrite {
  readonly id: string;
  readonly words: string;
}

/** The row as `personal_fact` holds it, words still sealed. */
const SealedFactRowSchema = Schema.Struct({
  id: Schema.String,
  sealedWords: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("sealed_words")),
  createdAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(Schema.fromKey("created_at")),
});

/** What a replacement needs of the row it is about to delete: the instant it was first remembered. */
const HeldFactRowSchema = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(Schema.fromKey("created_at")),
});

const FactInsertSchema = Schema.Struct({
  userId: Schema.String,
  id: Schema.String,
  ordinal: Schema.Number,
  sealedWords: Schema.String,
  createdAt: Schema.Number,
});

const findFacts = SqlSchema.findAll({
  Request: Schema.String,
  Result: SealedFactRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select id, sealed_words, created_at
        from personal_fact
        where user_id = ${userId}
        order by ordinal asc
      `,
    ),
});

const findHeldFacts = SqlSchema.findAll({
  Request: Schema.String,
  Result: HeldFactRowSchema,
  execute: (userId) =>
    statement((sql) => sql`select id, created_at from personal_fact where user_id = ${userId}`),
});

/** Locks the user's row for the replacement's duration, so two replacements land one after the other. */
const lockUser = (userId: string) =>
  statement((sql) => sql`select id from "user" where id = ${userId} for update`);

const deleteFacts = (userId: string) =>
  statement((sql) => sql`delete from personal_fact where user_id = ${userId}`);

const insertFact = SqlSchema.void({
  Request: FactInsertSchema,
  execute: (row) =>
    statement(
      (sql) => sql`
        insert into personal_fact (user_id, id, ordinal, sealed_words, created_at)
        values (${row.userId}, ${row.id}, ${row.ordinal}, ${row.sealedWords}, ${row.createdAt})
      `,
    ),
});

/** Opens every row it can, skipping one the seal cannot open rather than failing the whole list. */
function openFacts(
  seal: UserSeal,
  rows: ReadonlyArray<{
    readonly id: string;
    readonly sealedWords: string;
    readonly createdAt: number;
  }>,
): StoredFact[] {
  const facts: StoredFact[] = [];
  for (const row of rows) {
    let words: string;
    try {
      words = seal.open(row.sealedWords);
    } catch {
      continue;
    }
    facts.push({ id: row.id, words, createdAt: row.createdAt });
  }
  return facts;
}

export function listFacts(
  seal: UserSeal,
  userId: string,
): Effect.Effect<readonly StoredFact[], FactsFailure, SqlClient.SqlClient> {
  return Effect.map(findFacts(userId), (rows) => openFacts(seal, rows));
}

/**
 * Replaces the list whole under the user's row lock, so two replacements
 * land one after the other rather than each deleting what it saw and both
 * inserting; a fact keeping its id keeps the instant it was first remembered.
 */
export function replaceFacts(
  seal: UserSeal,
  userId: string,
  facts: readonly FactWrite[],
  now: number,
): Effect.Effect<readonly StoredFact[], FactsFailure, SqlClient.SqlClient> {
  return statement((sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* lockUser(userId);
        const held = yield* findHeldFacts(userId);
        const remembered = new Map(held.map((row) => [row.id, row.createdAt]));
        yield* deleteFacts(userId);
        yield* Effect.forEach(
          facts,
          (fact, ordinal) =>
            insertFact({
              userId,
              id: fact.id,
              ordinal,
              sealedWords: seal.seal(fact.words),
              createdAt: remembered.get(fact.id) ?? now,
            }),
          { discard: true },
        );
        return yield* listFacts(seal, userId);
      }),
    ),
  );
}
