import { Cause, Effect, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { ADMIN_ERROR, ADMIN_HTTP_STATUS, errorResponse } from "./http.js";

/**
 * What a dashboard read or write answers: an effect over the ambient client,
 * which the handler composes into the answer it is already building, so the
 * edge serving the request is the one place the client behind it is provided.
 * How a statement fails is the driver's own refusal or a row this build cannot
 * decode, the same pair every query in `admin-queries.ts` answers with.
 */
export type AdminSeamEffect<A> = Effect.Effect<
  A,
  SqlError | Schema.SchemaError,
  SqlClient.SqlClient
>;

/**
 * A seam that did not answer, as the one refusal every read words the same
 * way: a 503 the page can say "try again" to rather than an unhandled crash
 * the browser reads as a platform error page. Whatever went wrong is logged
 * where the deployment reads it and never carried into the answer, and a
 * defect is caught beside a failure because a seam that threw and a statement
 * that was refused are the same outage to the page.
 */
export function unavailableSeam<Failure>(
  message: string,
  cause: Cause.Cause<Failure>,
): Effect.Effect<Response> {
  return Effect.sync(() => {
    console.error(message, Cause.squash(cause));
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  });
}
