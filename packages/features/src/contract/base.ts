/**
 * base.ts -- the builder every hosted procedure contract starts from, and the inputs a JSON body is read through.
 *
 * The import above is oRPC's Effect input-output extension, loaded here
 * because every contract module builds from this one, so `.input` and
 * `.output` take an Effect Schema before any contract is declared. Every
 * procedure declares the refusals any procedure may answer and those its
 * handler answers beyond them (`declaredProcedure`, `refuses`); a refusal
 * it does not declare is reported by the service and read by a client as no
 * answer.
 *
 * A JSON body is read as the old routes read one (`readEither`): a key its
 * schema does not name is refused, where the extension would drop it.
 *
 * A procedure that takes a body may hold it to a cap of its own, in bytes
 * (`bodyCap`), which the handler counts as the body is read and refuses past
 * as too large before any of it is parsed; one that names none is held to
 * the handler's own ceiling.
 */

import "@orpc/experimental-effect/extensions/input-output";
import { defineMeta, oc } from "@orpc/contract";
import { Schema as EffectSchema } from "effect";
import { HOSTED_API_ERROR, type HostedApiError } from "../service-wire.js";
import { HOSTED_ERRORS } from "./errors.js";

/**
 * The refusals any procedure may answer whatever it does, through the
 * service's handler and the caller middleware every procedure runs behind
 * (`packages/service/src/orpc/`): a bearer or session it does not take,
 * an input its schema refuses or an idempotency key past its bound, a
 * body past its cap, and a store or auth service that could not answer
 * while its caller was read. A client reads each as no answer unless it
 * names it (`hosted-call.ts`).
 */
export const ANY_PROCEDURE_REFUSALS = [
  HOSTED_API_ERROR.INVALID_TOKEN,
  HOSTED_API_ERROR.INVALID_REQUEST,
  HOSTED_API_ERROR.REQUEST_TOO_LARGE,
  HOSTED_API_ERROR.UNAVAILABLE,
] as const;

/** The refusals named, each as the one map declares it, its fields included. */
export function refuses<const Slugs extends readonly HostedApiError[]>(
  ...slugs: Slugs
): Pick<typeof HOSTED_ERRORS, Slugs[number]> {
  const declared: Partial<Record<HostedApiError, (typeof HOSTED_ERRORS)[HostedApiError]>> = {};
  for (const slug of slugs) declared[slug] = HOSTED_ERRORS[slug];
  // SAFETY: every slug named was copied from the map above, and only those.
  return declared as Pick<typeof HOSTED_ERRORS, Slugs[number]>;
}

/** The builder a procedure that declares its own refusals starts from: those any procedure may answer, and its own added with `.errors(refuses(...))`. */
export const declaredProcedure = oc.errors(refuses(...ANY_PROCEDURE_REFUSALS));

/**
 * The most bytes a procedure's body may carry, and its reader: the cap is
 * counted over the bytes actually read, whatever `content-length` says, and
 * a later cap replaces an earlier one.
 */
export const [bodyCap, getBodyCap] = defineMeta(
  "bodyCap",
  (incoming: number, _current: number | undefined) => incoming,
);

/**
 * A JSON body's schema as a Standard Schema whose decode refuses a key it
 * does not name, as the old groups' `readEither` refused one; the effect
 * extension's own conversion ignores an excess key. The schema is made
 * afresh from its AST, because the conversion writes the Standard Schema
 * onto the schema it is handed.
 */
export function exactInput<Type, Encoded>(schema: EffectSchema.Codec<Type, Encoded>) {
  return EffectSchema.toStandardSchemaV1(
    EffectSchema.make<EffectSchema.Codec<Type, Encoded>>(schema.ast),
    {
      parseOptions: { onExcessProperty: "error" },
    },
  );
}

/**
 * A procedure's input with both path parameters and a JSON body, read with
 * `inputStructure: "detailed"`, so the body stays the object it was sent as
 * (a check over its keys counts only its own): the body refuses a key it
 * does not name, as `exactInput` does, and the query and headers the
 * detailed input carries are passed over.
 */
export function exactBodyInput<Params, ParamsEncoded, Body, BodyEncoded>(
  params: EffectSchema.Codec<Params, ParamsEncoded>,
  body: EffectSchema.Codec<Body, BodyEncoded>,
) {
  return exactInput(
    EffectSchema.Struct({
      params,
      query: EffectSchema.optionalKey(EffectSchema.Unknown),
      headers: EffectSchema.optionalKey(EffectSchema.Unknown),
      body,
    }),
  );
}
