import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";

/**
 * The account's standing main conversation, opened on first use. Nothing
 * else opens the first main: Clear opens the next one in the same
 * transaction that stamps the last, and a read over an account with none
 * answers empty. The open takes the account's user row lock first, the same
 * lock Clear holds, so a first ask and a Clear on an account with no main
 * run one after the other and neither fails on the other's insert. Two
 * first asks racing here queue on that lock, and the second finds the
 * first's row. The partial unique index over the standing main is the
 * guarantee itself, and it stands whether or not anything catches its
 * refusal: a path that inserts a main without this lock is refused a second
 * row by the index and fails visibly, which is what makes the missing lock
 * a defect someone sees rather than a silence that answered. Nothing here
 * catches that refusal on purpose.
 */

/** How the open fails: the driver's own refusal, or a row the schema refused. */
type StandingMainFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const IdRowSchema = Schema.Struct({ id: Schema.String });

/** Postgres reserves the word `user`, so the identity table's name is quoted wherever it is written by hand. */
const lockUser = (userId: string) =>
  statement((sql) => sql`select id from "user" where id = ${userId} for update`);

const findStandingMain = SqlSchema.findOne({
  Request: Schema.String,
  Result: IdRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select id
        from conversations
        where user_id = ${userId} and kind = ${CONVERSATION_KIND.MAIN} and deleted_at is null
      `,
    ),
});

const OpenMainSchema = Schema.Struct({ userId: Schema.String, now: Schema.DateFromSelf });

const openMain = SqlSchema.findOne({
  Request: OpenMainSchema,
  Result: IdRowSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into conversations (user_id, kind, created_at, last_activity_at)
        values (${write.userId}, ${CONVERSATION_KIND.MAIN}, ${write.now}, ${write.now})
        returning id
      `,
    ),
});

/** The id of the account's standing main, opened now where none stood. */
export function standingMain(
  userId: string,
  now: Date,
): Effect.Effect<string, StandingMainFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* lockUser(userId);
        const standing = yield* findStandingMain(userId);
        if (Option.isSome(standing)) return standing.value.id;
        const opened = yield* openMain({ userId, now });
        if (Option.isNone(opened)) throw new Error("the open inserted no main conversation");
        return opened.value.id;
      }),
    ),
  );
}
