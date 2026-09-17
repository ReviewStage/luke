/**
 * store-failure.ts -- a store read the service could not make, written down where its cause is known.
 *
 * A statement the pool refused or a row that would not decode is not a
 * defect of this service: the database is unreachable, and the request or
 * the tool call it was made for cannot finish. What is written down here is
 * the failure's own kind and sentence and never a value it carried, since a
 * Schema failure's issue may quote the row. The two doors below are the two
 * places the failure is carried onward: a route answers the unavailable
 * refusal, and a tool seam fails as the tool contract's own unavailability.
 */
import { ToolHostUnavailable } from "@sidecar/runtime/vocabulary";
import { Effect, type Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
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
  const kind = failure._tag === "SqlError" ? failure.cause._tag : failure.issue._tag;
  return Effect.logWarning(`Hosted store unavailable: ${failure._tag}: ${kind}`);
}

/**
 * A store read over the request's own client, as a tool seam answers it: the
 * failure is logged here and the seam fails as `ToolHostUnavailable`, which
 * the executor answers as a rejected call. `mapError` touches the typed
 * channel alone, so an interruption of the fiber passes through untouched.
 */
export function toolHostSeam<A>(
  client: SqlClient.SqlClient,
  effect: Effect.Effect<A, StoreFailure, SqlClient.SqlClient>,
): Effect.Effect<A, ToolHostUnavailable> {
  return Effect.provideService(effect, SqlClient.SqlClient, client).pipe(
    Effect.tapError(logStoreFailure),
    Effect.mapError(() => new ToolHostUnavailable()),
  );
}
