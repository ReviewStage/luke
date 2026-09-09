import type { ProviderId } from "@sidecar/session";
import {
  isWireString,
  RECORD_EXTRA_KEYS,
  type Schema,
  s,
  TEXT_ENDS,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { countedNumber } from "./service-wire.js";

/**
 * The provider-key vault: which providers it accepts a key for, the shape a
 * key must have before it is stored, and what its three endpoints answer.
 */

/**
 * The cloud providers whose API keys the vault accepts. Only providers that
 * Luke's service can observe on the user's behalf belong here; local-only
 * providers supply their credentials directly on the user's machine.
 *
 * The values are a subset of `PROVIDER_ID` from `@sidecar/session`; the
 * `satisfies` constraint enforces that membership. A new entry must be a
 * known provider id and requires a matching server-side observation strategy,
 * which ships in a separate PR.
 *
 * This set must stay in sync with `CLOUD_AGENT_PROVIDER_LIST` in
 * `@sidecar/credentials`. That package is not importable here (it sits above
 * `@sidecar/hosted` in the dependency graph), so drift is caught by a
 * parity test in `apps/web/tests/hosted-vault.test.ts` instead.
 */
export const VAULT_PROVIDER_ID = {
  CONDUCTOR: "conductor",
} as const satisfies Record<string, ProviderId>;

export type VaultProviderId = (typeof VAULT_PROVIDER_ID)[keyof typeof VAULT_PROVIDER_ID];

const VAULT_PROVIDER_ID_SET: ReadonlySet<string> = new Set(Object.values(VAULT_PROVIDER_ID));

/** Whether an untrusted value names a provider the vault accepts keys for. */
export function isVaultProviderId(value: UnparsedWireValue): value is VaultProviderId {
  return isWireString(value) && VAULT_PROVIDER_ID_SET.has(value);
}

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

const VAULT_PROVIDER_ID_NAMES = Object.values(VAULT_PROVIDER_ID);

/** Confirms that a store operation landed. */
export interface VaultKeyStoreAnswer {
  stored: true;
}

/** Anything other than `{ stored: true }` is not a store that landed. */
export const vaultKeyStoreAnswerSchema: Schema<VaultKeyStoreAnswer> = s.record(
  { stored: s.literal(true) },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** One key entry as returned by the list endpoint — never contains the key. */
export interface VaultKeyListEntry {
  providerId: VaultProviderId;
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
export const vaultKeysListAnswerSchema: Schema<VaultKeysListAnswer> = s.record(
  {
    keys: s.array(
      s.record(
        {
          providerId: s.enumOf(VAULT_PROVIDER_ID_NAMES, { ends: TEXT_ENDS.TRIM }),
          updatedAt: countedNumber(),
        },
        { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
      ),
    ),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** Confirms whether a delete operation found and removed a key. */
export interface VaultKeyDeleteAnswer {
  deleted: boolean;
}

export const vaultKeyDeleteAnswerSchema: Schema<VaultKeyDeleteAnswer> = s.record(
  { deleted: s.boolean() },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
