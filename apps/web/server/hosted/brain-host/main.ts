import { and, eq, isNull } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { user } from "../../db/auth-schema.js";
import { db } from "../../db/query.js";
import { conversations } from "../../db/storage-schema.js";
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
type StandingMainFailure = SqlError | Schema.SchemaError;

const IdRowSchema = Schema.Struct({ id: Schema.String });

/**
 * Takes the account's user row lock for the transaction, which is what holds
 * a first ask and a Clear on an account with no main one after the other. The
 * lock is the whole of this statement, so it stands inside the transaction
 * below and nowhere else.
 */
const lockUser = (userId: string) =>
  db.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");

const findStandingMain = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: IdRowSchema,
  execute: (userId) =>
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.kind, CONVERSATION_KIND.MAIN),
          isNull(conversations.deletedAt),
        ),
      ),
});

const OpenMainSchema = Schema.Struct({ userId: Schema.String, now: Schema.Date });

const openMain = SqlSchema.findOneOption({
  Request: OpenMainSchema,
  Result: IdRowSchema,
  execute: (write) =>
    db
      .insert(conversations)
      .values({
        userId: write.userId,
        kind: CONVERSATION_KIND.MAIN,
        createdAt: write.now,
        lastActivityAt: write.now,
      })
      .returning({ id: conversations.id }),
});

/** The id of the account's standing main, opened now where none stood. */
export function standingMain(
  userId: string,
  now: Date,
): Effect.Effect<string, StandingMainFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
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
