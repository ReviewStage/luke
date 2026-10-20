/**
 * base.ts -- the builder every hosted procedure contract starts from, and the inputs a JSON body is read through.
 *
 * The import above is oRPC's Effect input-output extension, loaded here
 * because every contract module builds from this one, so `.input` and
 * `.output` take an Effect Schema before any contract is declared. Every
 * procedure declares the whole refusal map: which refusals a route answers
 * is its handler's to say, and a refusal it answers is then always a
 * declared error rather than an unknown one.
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
import { HOSTED_ERRORS } from "./errors.js";

export const hostedProcedure = oc.errors(HOSTED_ERRORS);

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
