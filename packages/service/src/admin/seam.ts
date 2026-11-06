import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import { causeKind, unlessInterrupted } from "@repo/runtime/effect";
import { type Cause, Effect, type Schema } from "effect";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";

export type AdminSeamEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

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
