import { Schema as EffectSchema } from "effect";

/**
 * account-wire.ts -- the account's preferences snapshot, its access, its grant of support access, and its deletion, as `/api/account/*` carries them.
 *
 * The snapshot is the settings vocabulary's (`@repo/settings`), which sits
 * above this boundary, so each part is declared here only as far as the wire
 * knows it: the shared `preferences` a record, the link choice, the coding
 * agents' default, the chapters model, and the experiments as whatever they carry, and the
 * instant the shared part was last written. Each part is read the rest of
 * the way by its owner: the settings readers on the service and in the
 * host's preferences client, `modelChoiceSchema` for the default
 * (`models-wire.ts`), `chaptersModelFrom` for the chapters model
 * (`chapters-model-choice.ts`). A write carries any of the nine parts and is read the
 * same way, a part the service does not take refused there.
 */

/** The preferences snapshot (GET, and every PUT's answer). */
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
  /** When the shared part was last written, in epoch milliseconds; absent while it never was. */
  updatedAt: EffectSchema.optionalKey(EffectSchema.Number),
  /** The transaction a write committed in, which the account's live read of its preferences carries once it shows it; absent from a read, and from a service before it. */
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export type AccountPreferencesAnswerWire = typeof accountPreferencesAnswerSchema.Type;

/** A write (PUT): any of the snapshot's nine parts, each read by its owner on the service. */
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

/**
 * The member's grant of support access as it stands after a grant (POST)
 * or a revoke (DELETE): when it runs out, in epoch milliseconds, or null
 * once revoked.
 */
export const supportAccessAnswerSchema = EffectSchema.Struct({
  supportAccessUntil: EffectSchema.NullOr(EffectSchema.Number),
});

export type SupportAccessAnswerWire = typeof supportAccessAnswerSchema.Type;

/** The account erased (POST). */
export const accountDeleteAnswerSchema = EffectSchema.Struct({
  deleted: EffectSchema.Literal(true),
});

/**
 * What the signed-in account may open in the app's clients (GET): whether it
 * is an admin, and who may open it as them, and nothing of any other
 * account. A client draws by it and authorizes nothing: the admin
 * dashboard's own gate decides every read, the Start route every Start, and
 * the auth service every support sign-in.
 */
export const accountAccessAnswerSchema = EffectSchema.Struct({
  admin: EffectSchema.Boolean,
  /**
   * When the member's grant of support access runs out, in epoch
   * milliseconds, while one stands; null where none does. Absent from a
   * service older than it.
   */
  supportAccessUntil: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.Number)),
});
