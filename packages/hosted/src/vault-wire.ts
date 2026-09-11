import { CLOUD_AGENT_PROVIDER_ID, type CloudAgentProviderId } from "@sidecar/session";
import { type Schema, s } from "@sidecar/wire";
import { emitJsonSchema, readEither, toSchemaRead, verbatimJsonSchema } from "@sidecar/wire/effect";
import { Schema as EffectSchema } from "effect";
import { countedNumberEffect } from "./service-wire.js";

/**
 * The provider-key vault: which providers it accepts a key for, the shape a
 * key must have before it is stored, and what its three endpoints answer.
 *
 * Every declaration below is composed directly as an Effect `Schema`, under
 * its own `<name>Effect` export; the plain `<name>` export beside it is the
 * same declaration read through `fromEffect` (the pattern P1-04 established
 * in `packages/wire/src/ui-message-metadata.ts`), which is what still
 * answers the facade's `read`/`parse`/`jsonSchema` for `vault-client.ts`'s
 * `.parse()` callers. The facade twin is the strangler shim P12-08 deletes,
 * once every caller declares against the `Effect` export directly.
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
 * The Effect schema a declaration was composed from, adapted to the facade
 * still-held callers use: `read` through `readEither`, `jsonSchema` through
 * the emitter walking the same schema.
 */
function fromEffect<Value, Encoded>(core: EffectSchema.Schema<Value, Encoded>): Schema<Value> {
  const read = readEither(core);
  return s.reader({
    read: (value) => toSchemaRead(read(value)),
    jsonSchema: () => emitJsonSchema(core),
  });
}

/**
 * A record that ignores a key a newer service added, which is what an answer
 * does. Each record states its own rule, because Effect hands a struct's
 * parse options down to the structs inside it.
 */
const tolerantRecord = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/** A member set read with its ends trimmed, the way `s.enumOf({ ends: TEXT_ENDS.TRIM })` reads one. */
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
export const vaultKeyStoreAnswerSchemaEffect = tolerantRecord({
  stored: EffectSchema.Literal(true),
});

export const vaultKeyStoreAnswerSchema: Schema<VaultKeyStoreAnswer> = fromEffect(
  vaultKeyStoreAnswerSchemaEffect,
);

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
export const vaultKeysListAnswerSchemaEffect = tolerantRecord({
  keys: EffectSchema.mutable(
    EffectSchema.Array(
      tolerantRecord({
        providerId: trimmedEnum(CLOUD_AGENT_PROVIDER_NAMES),
        updatedAt: countedNumberEffect,
      }),
    ),
  ),
});

export const vaultKeysListAnswerSchema: Schema<VaultKeysListAnswer> = fromEffect(
  vaultKeysListAnswerSchemaEffect,
);

/** Confirms whether a delete operation found and removed a key. */
export interface VaultKeyDeleteAnswer {
  deleted: boolean;
}

export const vaultKeyDeleteAnswerSchemaEffect = tolerantRecord({ deleted: EffectSchema.Boolean });

export const vaultKeyDeleteAnswerSchema: Schema<VaultKeyDeleteAnswer> = fromEffect(
  vaultKeyDeleteAnswerSchemaEffect,
);
