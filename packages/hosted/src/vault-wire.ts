import { CLOUD_AGENT_PROVIDER_ID, type CloudAgentProviderId } from "@sidecar/session";
import { verbatimJsonSchema } from "@sidecar/wire/effect";
import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";

/**
 * The provider-key vault: which providers it accepts a key for, the shape a
 * key must have before it is stored, and what its three endpoints answer.
 *
 * Every declaration below is composed directly as an Effect `Schema` and
 * exported under its own name; `vault-client.ts` reads one through
 * `readEither` and shows it through `emitJsonSchema`.
 */

/** Maximum length the vault accepts for a provider API key. */
export const VAULT_KEY_MAX_LENGTH = 512;

/**
 * The shape a provider key must have before the vault stores it: non-empty,
 * no whitespace anywhere, bounded length. Loose by design — shape validation
 * only, never provider-specific format. Living on the wire contract, the
 * desktop refuses the same keys the service would, before one travels.
 */
export function vaultKeyIsStorable(key: string): boolean {
  return key.length > 0 && key.length <= VAULT_KEY_MAX_LENGTH && !/\s/u.test(key);
}

const CLOUD_AGENT_PROVIDER_NAMES = Object.values(CLOUD_AGENT_PROVIDER_ID);

/**
 * A record that ignores a key a newer service added, which is what an answer
 * does. Each record states its own rule, because Effect hands a struct's
 * parse options down to the structs inside it.
 */
const tolerantRecord = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/** A member set read with its ends trimmed. */
function trimmedEnum<const Member extends string>(members: readonly Member[]) {
  return verbatimJsonSchema(
    EffectSchema.transform(EffectSchema.String, EffectSchema.Literal(...members), {
      strict: false,
      decode: (value) => value.trim(),
      encode: (value) => value,
    }),
    { type: "string", enum: members },
  );
}

/** Confirms that a store operation landed. */
export interface VaultKeyStoreAnswer {
  stored: true;
}

/** Anything other than `{ stored: true }` is not a store that landed. */
export const vaultKeyStoreAnswerSchema = tolerantRecord({
  stored: EffectSchema.Literal(true),
});

/** One key entry as returned by the list endpoint — never contains the key. */
export interface VaultKeyListEntry {
  providerId: CloudAgentProviderId;
  updatedAt: number;
}

/** The list endpoint answer. */
export interface VaultKeysListAnswer {
  keys: VaultKeyListEntry[];
}

/**
 * The whole list drops on one malformed entry rather than skipping it: a key
 * silently missing from the list is a key the panel offers no way to replace
 * or delete, which is worse than a list that plainly did not read.
 */
export const vaultKeysListAnswerSchema = tolerantRecord({
  keys: EffectSchema.mutable(
    EffectSchema.Array(
      tolerantRecord({
        providerId: trimmedEnum(CLOUD_AGENT_PROVIDER_NAMES),
        updatedAt: countedNumber,
      }),
    ),
  ),
});

/** Confirms whether a delete operation found and removed a key. */
export interface VaultKeyDeleteAnswer {
  deleted: boolean;
}

export const vaultKeyDeleteAnswerSchema = tolerantRecord({ deleted: EffectSchema.Boolean });
