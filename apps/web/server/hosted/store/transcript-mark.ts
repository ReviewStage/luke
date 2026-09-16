import { and, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../../db/query.js";
import { transcriptMark } from "../../db/roster-schema.js";
import { EpochMillisColumnSchema } from "./database.js";

/**
 * The opener's high-water mark over an account's transcripts: the instant,
 * as the provider stamps a chat's transcript last changed, up to which every
 * change has been handed to the brain. One row per account, a bare instant
 * with nothing to seal, moved only forward and only over the mark the visit
 * read, so two visits that overlapped cannot put it back.
 *
 * Every function here is an `Effect<A, SqlError | Schema.SchemaError,
 * SqlClient.SqlClient>` over `effect/unstable/sql`, its statement a Drizzle
 * builder over the table `db/roster-schema.ts` declares.
 */

type MarkFailure = SqlError | Schema.SchemaError;

const MarkRowSchema = Schema.Struct({ mark: EpochMillisColumnSchema });

const findMark = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: MarkRowSchema,
  execute: (userId) =>
    db
      .select({ mark: transcriptMark.mark })
      .from(transcriptMark)
      .where(eq(transcriptMark.userId, userId)),
});

/** The mark standing for the account, or nothing before the opener's first visit. */
export function readTranscriptMark(
  userId: string,
): Effect.Effect<number | undefined, MarkFailure, SqlClient.SqlClient> {
  return Effect.map(findMark(userId), (row) =>
    Option.getOrUndefined(Option.map(row, (found) => found.mark)),
  );
}

const MarkWriteSchema = Schema.Struct({
  userId: Schema.String,
  mark: Schema.Number,
  updatedAt: Schema.Date,
});

const KeptRowSchema = Schema.Struct({ userId: Schema.String });

/** A first mark: lands only where none stands. */
const insertMark = SqlSchema.findAll({
  Request: MarkWriteSchema,
  Result: KeptRowSchema,
  execute: (write) =>
    db
      .insert(transcriptMark)
      .values({ userId: write.userId, mark: write.mark, updatedAt: write.updatedAt })
      .onConflictDoNothing({ target: transcriptMark.userId })
      .returning({ userId: transcriptMark.userId }),
});

/** A later mark: lands only over the one standing at `from`, and never where none stands, since a row gone mid-visit was forgotten on purpose. */
const updateMark = SqlSchema.findAll({
  Request: Schema.Struct({ ...MarkWriteSchema.fields, from: Schema.Number }),
  Result: KeptRowSchema,
  execute: (write) =>
    db
      .update(transcriptMark)
      .set({ mark: write.mark, updatedAt: write.updatedAt })
      .where(and(eq(transcriptMark.userId, write.userId), eq(transcriptMark.mark, write.from)))
      .returning({ userId: transcriptMark.userId }),
});

/**
 * Moves the mark, and only over the one the visit read from: a
 * compare-and-set, so a tick that ran long cannot put a later tick's mark
 * back, and a first mark lands only where none stands. Answers whether it
 * landed; a keep that did not leaves the changes to be read again on the
 * next visit, which is the direction this mark fails in. The opener runs it
 * inside the transaction that also keeps its transcript cursors.
 */
export function keepTranscriptMark(
  userId: string,
  mark: number,
  from: number | undefined,
  now: Date,
): Effect.Effect<boolean, MarkFailure, SqlClient.SqlClient> {
  const write = { userId, mark, updatedAt: now };
  return Effect.map(
    from === undefined ? insertMark(write) : updateMark({ ...write, from }),
    (rows) => rows.length > 0,
  );
}
