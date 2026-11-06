import { Schema as EffectSchema } from "effect";

export const accountPreferencesAnswerSchema = EffectSchema.Struct({
  preferences: EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
  linkOpen: EffectSchema.optionalKey(EffectSchema.Unknown),
  agentEnter: EffectSchema.optionalKey(EffectSchema.Unknown),
  commitAuthor: EffectSchema.optionalKey(EffectSchema.Unknown),
  setupFinished: EffectSchema.optionalKey(EffectSchema.Unknown),
  setupPlace: EffectSchema.optionalKey(EffectSchema.Unknown),
  agent: EffectSchema.optionalKey(EffectSchema.Unknown),
  chaptersModel: EffectSchema.optionalKey(EffectSchema.Unknown),
  experiments: EffectSchema.optionalKey(
    EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
  ),
  updatedAt: EffectSchema.optionalKey(EffectSchema.Number),
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export type AccountPreferencesAnswerWire = typeof accountPreferencesAnswerSchema.Type;

export const accountPreferencesWriteSchema = EffectSchema.Struct({
  preferences: EffectSchema.optionalKey(EffectSchema.Unknown),
  linkOpen: EffectSchema.optionalKey(EffectSchema.Unknown),
  agentEnter: EffectSchema.optionalKey(EffectSchema.Unknown),
  commitAuthor: EffectSchema.optionalKey(EffectSchema.Unknown),
  setupFinished: EffectSchema.optionalKey(EffectSchema.Unknown),
  setupPlace: EffectSchema.optionalKey(EffectSchema.Unknown),
  agent: EffectSchema.optionalKey(EffectSchema.Unknown),
  chaptersModel: EffectSchema.optionalKey(EffectSchema.Unknown),
  experiments: EffectSchema.optionalKey(EffectSchema.Unknown),
});

export const supportAccessAnswerSchema = EffectSchema.Struct({
  supportAccessUntil: EffectSchema.NullOr(EffectSchema.Number),
});

export type SupportAccessAnswerWire = typeof supportAccessAnswerSchema.Type;

export const accountDeleteAnswerSchema = EffectSchema.Struct({
  deleted: EffectSchema.Literal(true),
});

export const accountAccessAnswerSchema = EffectSchema.Struct({
  admin: EffectSchema.Boolean,
  supportAccessUntil: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.Number)),
});
