/**
 * store-failure.ts -- a store read the service could not make, written down where its cause is known.
 *
 * A statement the pool refused or a row that would not decode is not a
 * defect of this service: the database is unreachable, and the request or
 * the tool call it was made for cannot finish. What is written down here is
 * the failure's own kind and, for a `SqlError`, the code its driver's error
 * carries, and never a value it carried, since a Schema failure's issue may
 * quote the row and a statement's sentence can quote the key a constraint
 * refused. A route carries the failure onward as the unavailable refusal.
 */

import type { QueryError } from "@luke/database/core/query";
import { failureDetail, failureKind } from "@luke/runtime/effect";
import { Effect, Option, type Schema } from "effect";

export type StoreFailure = QueryError | Schema.SchemaError;

/**
 * The failure as one warning line of kinds alone: a `SqlError` by the kind of
 * its reason (a connection refused, a statement timed out) and the code its
 * driver's error carries (`SqlError: UnknownError (code 57P01)`, or
 * `(cause Error)` where it carries none), a Schema failure by the kind of its
 * issue. Neither's sentence is written, because a Schema issue's message
 * renders the value that would not decode, and a statement's can quote the
 * key a constraint refused. The procedure that asked is the log line's own
 * annotation (`orpc/base.ts`).
 */
export function logStoreFailure(failure: StoreFailure): Effect.Effect<void> {
  const detail = Option.match(failureDetail(failure), {
    onNone: () => "",
    onSome: (said) => ` (${said})`,
  });
  return Effect.logWarning(`Hosted store unavailable: ${failureKind(failure)}${detail}`);
}
