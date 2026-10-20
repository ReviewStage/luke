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
import { ADMIN_REFUSAL_STATUS } from "../admin/http-effect.js";
import { HOSTED_REFUSAL, HOSTED_REFUSAL_STATUS } from "../http/http-effect.js";
import type { HostedContext } from "./base.js";

/**
 * The status each refusal is answered with: the hosted vocabulary's, and the
 * admin dashboard's own (`admin/http-effect.ts`), which a browser alone reads.
 * A slug both spell (`not-found`, `method-not-allowed`, `unavailable`) has
 * the same status in each.
 */
const REFUSAL_STATUS = { ...ADMIN_REFUSAL_STATUS, ...HOSTED_REFUSAL_STATUS };

/** Every slug a refusal may carry, which is every slug that has a status. */
const REFUSAL_SLUGS = [
  ...Object.values(HOSTED_REFUSAL).map((refusal) => refusal.error),
  ...Object.keys(ADMIN_REFUSAL_STATUS),
];

/** oRPC's own code for an input that failed its schema, which the hosted vocabulary calls an invalid request. */
const ORPC_BAD_REQUEST = "BAD_REQUEST";

/** oRPC's own code for a body past the handler's request limit, which the hosted vocabulary calls a request too large. */
const ORPC_PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";

/** The status each error code is answered with: oRPC's own codes as oRPC answers them, and every refusal as the hosted vocabulary does. */
export const HOSTED_ERROR_STATUS = { ...COMMON_ERROR_STATUS_MAP, ...REFUSAL_STATUS };

/** A refusal as the failure channel carries it: a slug that has a status, the reason a repository is out of reach, and an upstream's status, where it has them. */
const isHostedRefusal = Schema.is(
  Schema.Struct({
    error: Schema.Literals(REFUSAL_SLUGS),
    unreached: Schema.optionalKey(repositoryUnreachedSchema),
    upstreamStatus: Schema.optionalKey(Schema.Int),
  }),
);

/** The fields a declared error's data carries beside its slug. */
const isRefusalFields = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

/** The refusal as the error the contract declares: its slug the code, everything beside it the data. */
function refusalError(refusal: { readonly error: string }): ORPCError<string, object> {
  const { error, ...data } = refusal;
  return new ORPCError(error, { data });
}

/**
 * Runs around every effectful handler and middleware: a `HostedRefusal` (or an admin `AdminRefusal`) in
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
 * schema refused as the invalid request the old groups answered, a body
 * past the handler's request limit as the request too large they answered,
 * and anything else left to the handler (`handler.ts` answers it as the old
 * groups answered a defect).
 */
export function encodeHostedError(error: ORPCError<string, unknown>): object | null {
  if (Object.hasOwn(REFUSAL_STATUS, error.code)) {
    return isRefusalFields(error.data)
      ? { error: error.code, ...error.data }
      : { error: error.code };
  }
  if (error.code === ORPC_BAD_REQUEST) return HOSTED_REFUSAL.INVALID_REQUEST;
  if (error.code === ORPC_PAYLOAD_TOO_LARGE) return HOSTED_REFUSAL.REQUEST_TOO_LARGE;
  return null;
}
