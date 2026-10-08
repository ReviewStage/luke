/**
 * store-failure.ts -- a store read the service could not make, written down where its cause is known.
 *
 * A statement the pool refused or a row that would not decode is not a
 * defect of this service: the database is unreachable, and the request or
 * the tool call it was made for cannot finish. What is written down here is
 * the failure's own kind and sentence and never a value it carried, since a
 * Schema failure's issue may quote the row. A route carries the failure
 * onward as the unavailable refusal.
 */
import { Effect, type Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

export type StoreFailure = SqlError | Schema.SchemaError;

/**
 * The failure as one warning line of kinds alone: a `SqlError` by the kind of
 * its reason (a connection refused, a statement timed out), a Schema failure
 * by the kind of its issue. Neither's sentence is written, because a Schema
 * issue's message renders the value that would not decode, and a statement's
 * can quote the key a constraint refused.
 */
export function logStoreFailure(failure: StoreFailure): Effect.Effect<void> {
  const kind = failure._tag === "SqlError" ? failure.reason._tag : failure.issue._tag;
  return Effect.logWarning(`Hosted store unavailable: ${failure._tag}: ${kind}`);
}
