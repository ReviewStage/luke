import "@orpc/experimental-effect/extensions/input-output";
import { oc } from "@orpc/contract";
import { Schema as EffectSchema } from "effect";

export const ACT_ERROR = { REFUSED: "REFUSED" } as const;

export function actProcedure(sentence: string) {
  return oc.errors({ [ACT_ERROR.REFUSED]: { message: sentence } });
}

export function exactInput<Type, Encoded>(schema: EffectSchema.Codec<Type, Encoded>) {
  const copy = EffectSchema.make<EffectSchema.Codec<Type, Encoded>>(schema.ast);
  return EffectSchema.toStandardSchemaV1(copy, { parseOptions: { onExcessProperty: "error" } });
}
