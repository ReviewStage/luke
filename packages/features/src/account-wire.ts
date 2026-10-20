import { Schema as EffectSchema } from "effect";

/**
 * account-wire.ts -- the account's preferences snapshot and its deletion, as `/api/account/*` carries them.
 *
 * The snapshot is the settings vocabulary's (`@luke/settings`), which sits
 * above this boundary, so each part is declared here only as far as the wire
 * knows it: the shared `preferences` a record, the link choice, the coding
 * agents' default, the chapters model, and the experiments as whatever they carry, and the
 * instant the shared part was last written. Each part is read the rest of
 * the way by its owner: the settings readers on the service and in the
 * host's preferences client, `modelChoiceSchema` for the default
 * (`models-wire.ts`), `chaptersModelFrom` for the chapters model
 * (`chapters-model-choice.ts`). A write carries any of the five parts and is read the
 * same way, a part the service does not take refused there.
 */

/** The preferences snapshot (GET, and every PUT's answer). */
export const accountPreferencesAnswerSchema = EffectSchema.Struct({
  preferences: EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
  linkOpen: EffectSchema.optionalKey(EffectSchema.Unknown),
  codingAgent: EffectSchema.optionalKey(EffectSchema.Unknown),
  chaptersModel: EffectSchema.optionalKey(EffectSchema.Unknown),
  experiments: EffectSchema.optionalKey(
    EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
  ),
  /** When the shared part was last written, in epoch milliseconds; absent while it never was. */
  updatedAt: EffectSchema.optionalKey(EffectSchema.Number),
});

export type AccountPreferencesAnswerWire = typeof accountPreferencesAnswerSchema.Type;

/** A write (PUT): any of the snapshot's five parts, each read by its owner on the service. */
export const accountPreferencesWriteSchema = EffectSchema.Struct({
  preferences: EffectSchema.optionalKey(EffectSchema.Unknown),
  linkOpen: EffectSchema.optionalKey(EffectSchema.Unknown),
  codingAgent: EffectSchema.optionalKey(EffectSchema.Unknown),
  chaptersModel: EffectSchema.optionalKey(EffectSchema.Unknown),
  experiments: EffectSchema.optionalKey(EffectSchema.Unknown),
});

/** The account erased (POST). */
export const accountDeleteAnswerSchema = EffectSchema.Struct({
  deleted: EffectSchema.Literal(true),
});
