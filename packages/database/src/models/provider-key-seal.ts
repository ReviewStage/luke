import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ProviderKeyProvider } from "@luke/features/provider-key-wire";
import { Redacted, Result } from "effect";

/**
 * provider-key-seal.ts -- an account's own provider key, or a workspace's environment value, sealed for the database, and opened again for the one call that needs it.
 *
 * Envelope encryption under AES-256-GCM. Every save draws a fresh 32-byte
 * data key, seals the provider key under it, and wraps the data key under
 * the deployment's current key-encryption key. The wrapped data key, the
 * sealed provider key, and the key-encryption key's version are what the
 * row holds; the key-encryption keys live only in the deployment's
 * environment, so a copy of the database alone opens nothing.
 *
 * Both seals bind the account and the provider as additional authenticated
 * data, and the wrap binds the version too, so a sealed key moved onto
 * another account's row, another provider's, or another version fails its
 * tag rather than opening as someone else's. Every failure to open is one
 * answer, unreadable, which names no cause: a wrong key, a tampered byte,
 * and a version the environment no longer holds are all a key the service
 * must not use.
 *
 * Rotation is a new version at the head of the environment's list: new
 * saves wrap under it, and `scripts/rewrap-provider-keys.sh` moves every
 * standing row onto it by unwrapping and rewrapping its data key, never
 * touching the provider key itself. A version stays in the list until no
 * row names it.
 *
 * A workspace's environment values (`workspace-environment-store.ts`) are
 * sealed the same way under the same ring, with purposes of their own and
 * bound to the workspace and the variable's name, so a provider key never
 * opens as an environment value or the reverse.
 */

/** The environment the key-encryption keys are read from. */
export const PROVIDER_KEY_ENCRYPTION_ENVIRONMENT = {
  /** `<version>:<base64 of 32 random bytes>` entries, comma-separated, the current version first. */
  KEYS: "PROVIDER_KEY_ENCRYPTION_KEYS",
} as const;

const SEAL = {
  ALGORITHM: "aes-256-gcm",
  KEY_BYTES: 32,
  NONCE_BYTES: 12,
  TAG_BYTES: 16,
} as const;

/** What each seal's additional data names first, so a wrapped data key never opens as a sealed value or the reverse, and one kind of value never as another. */
interface SealPurpose {
  readonly DATA_KEY: string;
  readonly VALUE: string;
}

const PROVIDER_KEY_PURPOSE: SealPurpose = {
  DATA_KEY: "luke/provider-key/data-key",
  VALUE: "luke/provider-key/key",
};

const WORKSPACE_ENVIRONMENT_PURPOSE: SealPurpose = {
  DATA_KEY: "luke/workspace-environment/data-key",
  VALUE: "luke/workspace-environment/value",
};

/** One entry of the environment's list: a version of one to six digits and a 32-byte key in standard base64. */
const KEY_ENTRY = /^(\d{1,6}):([A-Za-z0-9+/]{43}=)$/u;

/** Why the environment's list is no list; it names the shape that is wrong and never a value. */
const KEY_RING_FAULT = {
  EMPTY: "it names no key",
  MALFORMED: "an entry is not <version>:<base64 of 32 bytes>",
  DUPLICATE: "a version is named twice",
} as const;

export type KeyRingFault = (typeof KEY_RING_FAULT)[keyof typeof KEY_RING_FAULT];

/** The deployment's key-encryption keys: the version new seals wrap under, and every version a row may still name. */
export interface KeyRing {
  readonly current: number;
  readonly keys: ReadonlyMap<number, Redacted.Redacted<Uint8Array>>;
}

/** What a row holds of one provider key. */
export interface SealedProviderKey {
  readonly keyVersion: number;
  /** base64 of nonce, ciphertext, and tag: the data key under the key-encryption key. */
  readonly sealedDataKey: string;
  /** base64 of nonce, ciphertext, and tag: the provider key under the data key. */
  readonly sealedKey: string;
}

/** Whose key a seal is, which both seals bind. */
export interface SealOwner {
  readonly userId: string;
  readonly provider: ProviderKeyProvider;
}

/** Which workspace variable a seal is, which both seals bind. */
export interface EnvironmentSealOwner {
  readonly organizationId: string;
  readonly name: string;
}

/** What a seal is bound to: its purposes, and the names its row stands under, in order. */
interface SealBinding {
  readonly purpose: SealPurpose;
  readonly names: readonly string[];
}

/** A sealed key the service cannot open: it is used for nothing until it is replaced. */
export const PROVIDER_KEY_UNREADABLE = "unreadable";

export type ProviderKeyUnreadable = typeof PROVIDER_KEY_UNREADABLE;

function providerBinding(owner: SealOwner): SealBinding {
  return { purpose: PROVIDER_KEY_PURPOSE, names: [owner.userId, owner.provider] };
}

function environmentBinding(owner: EnvironmentSealOwner): SealBinding {
  return { purpose: WORKSPACE_ENVIRONMENT_PURPOSE, names: [owner.organizationId, owner.name] };
}

function additionalData(purpose: string, names: readonly string[], version?: number): Buffer {
  // A JSON array, so no account id can be spelled to run into the provider beside it.
  const named = version === undefined ? [purpose, ...names] : [purpose, ...names, version];
  return Buffer.from(JSON.stringify(named), "utf8");
}

function sealBytes(key: Uint8Array, plaintext: Uint8Array, aad: Buffer): string {
  const nonce = randomBytes(SEAL.NONCE_BYTES);
  const cipher = createCipheriv(SEAL.ALGORITHM, key, nonce);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64");
}

/** The plaintext, or nothing where the tag does not verify or the bytes are no seal. */
function openBytes(key: Uint8Array, sealed: string, aad: Buffer): Buffer | undefined {
  const bytes = Buffer.from(sealed, "base64");
  if (bytes.length < SEAL.NONCE_BYTES + SEAL.TAG_BYTES) return undefined;
  const nonce = bytes.subarray(0, SEAL.NONCE_BYTES);
  const tag = bytes.subarray(bytes.length - SEAL.TAG_BYTES);
  const body = bytes.subarray(SEAL.NONCE_BYTES, bytes.length - SEAL.TAG_BYTES);
  try {
    const decipher = createDecipheriv(SEAL.ALGORITHM, key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // Note that the cause is dropped on purpose: a failed tag is the one answer, and its wording is no one's to read.
    return undefined;
  }
}

/** The data key a row wraps, or nothing where its version is gone or its wrap does not open. */
function openDataKey(
  ring: KeyRing,
  binding: SealBinding,
  sealed: SealedProviderKey,
): Buffer | undefined {
  const wrapping = ring.keys.get(sealed.keyVersion);
  if (wrapping === undefined) return undefined;
  const aad = additionalData(binding.purpose.DATA_KEY, binding.names, sealed.keyVersion);
  const dataKey = openBytes(Redacted.value(wrapping), sealed.sealedDataKey, aad);
  return dataKey?.length === SEAL.KEY_BYTES ? dataKey : undefined;
}

function wrapDataKey(
  ring: KeyRing,
  binding: SealBinding,
  dataKey: Uint8Array,
): Pick<SealedProviderKey, "keyVersion" | "sealedDataKey"> {
  const wrapping = ring.keys.get(ring.current);
  // The parse puts the current version in the map, so its absence is a ring built by hand wrongly.
  if (wrapping === undefined)
    throw new Error("The key ring names a current version it does not hold.");
  const aad = additionalData(binding.purpose.DATA_KEY, binding.names, ring.current);
  return {
    keyVersion: ring.current,
    sealedDataKey: sealBytes(Redacted.value(wrapping), dataKey, aad),
  };
}

function sealValue(
  ring: KeyRing,
  binding: SealBinding,
  value: Redacted.Redacted<string>,
): SealedProviderKey {
  const dataKey = randomBytes(SEAL.KEY_BYTES);
  const sealedKey = sealBytes(
    dataKey,
    Buffer.from(Redacted.value(value), "utf8"),
    additionalData(binding.purpose.VALUE, binding.names),
  );
  const wrapped = wrapDataKey(ring, binding, dataKey);
  dataKey.fill(0);
  return { ...wrapped, sealedKey };
}

function openValue(
  ring: KeyRing,
  binding: SealBinding,
  sealed: SealedProviderKey,
): Result.Result<Redacted.Redacted<string>, ProviderKeyUnreadable> {
  const dataKey = openDataKey(ring, binding, sealed);
  if (dataKey === undefined) return Result.fail(PROVIDER_KEY_UNREADABLE);
  const opened = openBytes(
    dataKey,
    sealed.sealedKey,
    additionalData(binding.purpose.VALUE, binding.names),
  );
  dataKey.fill(0);
  if (opened === undefined) return Result.fail(PROVIDER_KEY_UNREADABLE);
  const value = Redacted.make(opened.toString("utf8"));
  opened.fill(0);
  return Result.succeed(value);
}

function rewrapValue(
  ring: KeyRing,
  binding: SealBinding,
  sealed: SealedProviderKey,
): Result.Result<SealedProviderKey, ProviderKeyUnreadable> {
  const dataKey = openDataKey(ring, binding, sealed);
  if (dataKey === undefined) return Result.fail(PROVIDER_KEY_UNREADABLE);
  const wrapped = wrapDataKey(ring, binding, dataKey);
  dataKey.fill(0);
  return Result.succeed({ ...wrapped, sealedKey: sealed.sealedKey });
}

/** The ring the environment's value names, or which shape it breaks. */
export function parseKeyRing(value: Redacted.Redacted): Result.Result<KeyRing, KeyRingFault> {
  const entries = Redacted.value(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (entries.length === 0) return Result.fail(KEY_RING_FAULT.EMPTY);
  const keys = new Map<number, Redacted.Redacted<Uint8Array>>();
  let current: number | undefined;
  for (const entry of entries) {
    const matched = KEY_ENTRY.exec(entry);
    if (matched === null) return Result.fail(KEY_RING_FAULT.MALFORMED);
    const version = Number(matched[1]);
    const key = Buffer.from(matched[2] ?? "", "base64");
    if (version < 1 || key.length !== SEAL.KEY_BYTES) return Result.fail(KEY_RING_FAULT.MALFORMED);
    if (keys.has(version)) return Result.fail(KEY_RING_FAULT.DUPLICATE);
    keys.set(version, Redacted.make(new Uint8Array(key)));
    current ??= version;
  }
  if (current === undefined) return Result.fail(KEY_RING_FAULT.EMPTY);
  return Result.succeed({ current, keys });
}

/** The provider key sealed for its owner's row under a fresh data key, wrapped under the ring's current version. */
export function sealProviderKey(
  ring: KeyRing,
  owner: SealOwner,
  key: Redacted.Redacted<string>,
): SealedProviderKey {
  return sealValue(ring, providerBinding(owner), key);
}

/** The provider key a row seals, sealed again at once, or unreadable where any part of it does not open for this owner. */
export function openProviderKey(
  ring: KeyRing,
  owner: SealOwner,
  sealed: SealedProviderKey,
): Result.Result<Redacted.Redacted<string>, ProviderKeyUnreadable> {
  return openValue(ring, providerBinding(owner), sealed);
}

/** The row's data key wrapped again under the ring's current version, the provider key's seal untouched; unreadable where its wrap does not open. */
export function rewrapProviderKey(
  ring: KeyRing,
  owner: SealOwner,
  sealed: SealedProviderKey,
): Result.Result<SealedProviderKey, ProviderKeyUnreadable> {
  return rewrapValue(ring, providerBinding(owner), sealed);
}

/** A workspace's environment value sealed for its variable's row under a fresh data key, wrapped under the ring's current version. */
export function sealEnvironmentValue(
  ring: KeyRing,
  owner: EnvironmentSealOwner,
  value: Redacted.Redacted<string>,
): SealedProviderKey {
  return sealValue(ring, environmentBinding(owner), value);
}

/** The environment value a row seals, or unreadable where any part of it does not open for this workspace and name. */
export function openEnvironmentValue(
  ring: KeyRing,
  owner: EnvironmentSealOwner,
  sealed: SealedProviderKey,
): Result.Result<Redacted.Redacted<string>, ProviderKeyUnreadable> {
  return openValue(ring, environmentBinding(owner), sealed);
}

/** The environment row's data key wrapped again under the ring's current version, its value's seal untouched. */
export function rewrapEnvironmentValue(
  ring: KeyRing,
  owner: EnvironmentSealOwner,
  sealed: SealedProviderKey,
): Result.Result<SealedProviderKey, ProviderKeyUnreadable> {
  return rewrapValue(ring, environmentBinding(owner), sealed);
}
