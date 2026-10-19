/**
 * errors.ts -- a hosted refusal as an oRPC error, and that error as the bytes the old groups answered.
 *
 * An endpoint body still fails with a `HostedRefusal`; the wrap below turns
 * it into an `ORPCError` whose code is the refusal's slug and whose data is
 * whatever it carries beside the slug, which oRPC reconciles to the error
 * the contract declares. The encoder writes it back as the refusal itself,
 * `{ error: slug }` with its extra fields at the top level, under the status
 * `HOSTED_REFUSAL_STATUS` gives it, so a refusal answers exactly what
 * `hostedRefusalResponse` answered.
 */

import { repositoryUnreachedSchema } from "@luke/features/repository-reach-wire";
import { COMMON_ERROR_STATUS_MAP } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { Effect, Schema } from "effect";
import { HOSTED_REFUSAL, HOSTED_REFUSAL_STATUS, type HostedRefusal } from "../http/http-effect.js";
import type { HostedContext } from "./base.js";

/** Every slug a refusal may carry, which is every slug that has a status. */
const HOSTED_REFUSAL_SLUGS = Object.values(HOSTED_REFUSAL).map((refusal) => refusal.error);

/** oRPC's own code for an input that failed its schema, which the hosted vocabulary calls an invalid request. */
const ORPC_BAD_REQUEST = "BAD_REQUEST";

/** The status each error code is answered with: oRPC's own codes as oRPC answers them, and every refusal as the hosted vocabulary does. */
export const HOSTED_ERROR_STATUS = { ...COMMON_ERROR_STATUS_MAP, ...HOSTED_REFUSAL_STATUS };

/** A refusal as the failure channel carries it: a slug that has a status, and the reason a repository is out of reach where it has one. */
const isHostedRefusal = Schema.is(
  Schema.Struct({
    error: Schema.Literals(HOSTED_REFUSAL_SLUGS),
    unreached: Schema.optionalKey(repositoryUnreachedSchema),
  }),
);

/** The fields a declared error's data carries beside its slug. */
const isRefusalFields = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

/** The refusal as the error the contract declares: its slug the code, everything beside it the data. */
function refusalError(refusal: HostedRefusal): ORPCError<string, object> {
  const { error, ...data } = refusal;
  return new ORPCError(error, { data });
}

/**
 * Runs around every effectful handler and middleware: a `HostedRefusal` in
 * the failure channel becomes its declared error, and anything else passes
 * through as it was, so a failure that comes back through an outer layer is
 * left as the inner one made it.
 */
export const hostedRefusalWrap: NonNullable<HostedContext["effect/wrap"]> = <A, E>(
  effect: Effect.Effect<A, E>,
) =>
  Effect.mapError(
    effect,
    (failure): E =>
      // SAFETY: oRPC reads the wrapped effect's failure as `unknown` and settles an `ORPCError` among it; the generic `E` is the caller's view alone.
      isHostedRefusal(failure) ? (refusalError(failure) as E) : failure,
  );

/**
 * The body an error is answered with: a refusal as itself, an input its
 * schema refused as the invalid request the old groups answered, and
 * anything else left to the handler (`handler.ts` answers it as the old
 * groups answered a defect).
 */
export function encodeHostedError(error: ORPCError<string, unknown>): object | null {
  if (Object.hasOwn(HOSTED_REFUSAL_STATUS, error.code)) {
    return isRefusalFields(error.data)
      ? { error: error.code, ...error.data }
      : { error: error.code };
  }
  if (error.code === ORPC_BAD_REQUEST) return HOSTED_REFUSAL.INVALID_REQUEST;
  return null;
}
