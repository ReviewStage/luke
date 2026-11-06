import "@orpc/experimental-effect/extensions/input-output";
import { defineMeta, oc } from "@orpc/contract";
import { Schema as EffectSchema } from "effect";
import { HOSTED_ERRORS } from "./errors.js";

export const hostedProcedure = oc.errors(HOSTED_ERRORS);

export const [bodyCap, getBodyCap] = defineMeta(
  "bodyCap",
  (incoming: number, _current: number | undefined) => incoming,
);

export function exactInput<Type, Encoded>(schema: EffectSchema.Codec<Type, Encoded>) {
  return EffectSchema.toStandardSchemaV1(
    EffectSchema.make<EffectSchema.Codec<Type, Encoded>>(schema.ast),
    {
      parseOptions: { onExcessProperty: "error" },
    },
  );
}

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
