import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { causeKind, unlessInterrupted } from "@luke/runtime/effect";
import { type Cause, Effect, type Schema } from "effect";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";

/**
 * What a dashboard read or write answers: an effect over the ambient client,
 * which the handler composes into the answer it is already building, so the
 * edge serving the request is the one place the client behind it is provided.
 * How a statement fails is the driver's own refusal or a row this build cannot
 * decode, the same pair every query in `admin-queries.ts` answers with.
 */
export type AdminSeamEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

/**
 * A seam that did not answer, as the one refusal every read words the same
 * way: a 503 the page can say "try again" to rather than an unhandled crash
 * the browser reads as a platform error page. Whatever went wrong is logged
 * where the deployment reads it and never carried into the answer, and a
 * defect is caught beside a failure because a seam that threw and a statement
 * that was refused are the same outage to the page. An interruption is
 * neither: a client that disconnected or a function whose time ran out is no
 * outage to log, so it passes through as it came and answers nothing.
 */
export function unavailableSeam<Failure>(
  message: string,
  cause: Cause.Cause<Failure>,
): Effect.Effect<never, AdminRefusal> {
  return unlessInterrupted(cause, (other) =>
    Effect.andThen(
      Effect.logError(`${message}: ${causeKind(other)}`),
      Effect.fail(ADMIN_REFUSAL.UNAVAILABLE),
    ),
  );
}
