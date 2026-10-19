/**
 * base.ts -- the builder every hosted procedure contract starts from.
 *
 * The import above is oRPC's Effect input-output extension, loaded here
 * because every contract module builds from this one, so `.input` and
 * `.output` take an Effect Schema before any contract is declared. Every
 * procedure declares the whole refusal map: which refusals a route answers
 * is its handler's to say, and a refusal it answers is then always a
 * declared error rather than an unknown one.
 */

import "@orpc/experimental-effect/extensions/input-output";
import { oc } from "@orpc/contract";
import { Schema as EffectSchema } from "effect";
import { HOSTED_ERRORS } from "./errors.js";

export const hostedProcedure = oc.errors(HOSTED_ERRORS);

/**
 * A JSON body's schema as a procedure's input, refusing a key it does not
 * declare, as the old groups' body reads did; the extension's own reading
 * of an Effect Schema passes one over. A query's input keeps that default,
 * since the old groups never read a query key they did not name.
 */
export function exactInput<Type, Encoded>(schema: EffectSchema.Codec<Type, Encoded>) {
  return EffectSchema.toStandardSchemaV1(EffectSchema.make<typeof schema>(schema.ast), {
    parseOptions: { onExcessProperty: "error" },
  });
}

/**
 * A procedure's path parameters and its JSON body as its input, under
 * `inputStructure: "detailed"`, so the body is read whole as its own schema
 * and never merged with the parameters, and refused with a key it does not
 * declare (`exactInput`).
 */
export function exactBodyInput<ParamsType, ParamsEncoded, BodyType, BodyEncoded>(
  params: EffectSchema.Codec<ParamsType, ParamsEncoded>,
  body: EffectSchema.Codec<BodyType, BodyEncoded>,
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
