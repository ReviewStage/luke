/**
 * What every table module over the store's `@effect/sql` client shares: how a
 * row whose columns do not decode is treated, and how a conditional write's
 * refusal is read.
 *
 * These modules are the only writers of the columns they read, so a column of
 * another kind is a violation of the schema they own rather than a value to
 * reason about: the decode dies where a `SqlError` would be reported, and the
 * error a caller can act on stays the one the database answered. A stored
 * payload's own content is the other half and is not this — an entry this
 * build cannot vouch for drops its row where the row is read, as it always
 * has — because a payload carries what a provider or an earlier build wrote
 * and a column carries what these modules wrote.
 */

import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

/** A row read whose column decode is a defect rather than a failure a caller handles. */
export const columnsDecoded = <A, R>(
  read: Effect.Effect<A, ParseError | SqlError, R>,
): Effect.Effect<A, SqlError, R> =>
  Effect.catchTag(read, "ParseError", (issue) => Effect.die(issue));

const Changes = Schema.Struct({
  changes: Schema.Union(Schema.Number, Schema.BigIntFromSelf),
});

type Changes = Schema.Schema.Type<typeof Changes>;

const decodeChanges = Schema.decodeUnknown(Changes);

const countOf = (changes: Changes): number => Number(changes.changes);

/**
 * How many rows a write changed, read off the raw answer `node:sqlite` gives
 * the statement. A conditional write's refusal is zero changes, which is the
 * whole of how `OR IGNORE` and a `WHERE` that matched nothing are told apart
 * from a write that landed.
 */
export const changedRows = <R>(
  write: Effect.Effect<unknown, SqlError, R>,
): Effect.Effect<number, SqlError, R> =>
  Effect.map(columnsDecoded(Effect.flatMap(write, decodeChanges)), countOf);
