import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  PROVIDER_KEY_KIND,
  type ProviderKeyKind,
  type ProviderKeyProvider,
} from "@repo/features/provider-key-wire";
import { Redacted, Result, Schema } from "effect";

export const PROVIDER_KEY_ENCRYPTION_ENVIRONMENT = {
  KEYS: "PROVIDER_KEY_ENCRYPTION_KEYS",
} as const;

const SEAL = {
  ALGORITHM: "aes-256-gcm",
  KEY_BYTES: 32,
  NONCE_BYTES: 12,
  TAG_BYTES: 16,
} as const;

const SEAL_PURPOSE = {
  PROVIDER_KEY: { DATA_KEY: "luke/provider-key/data-key", SECRET: "luke/provider-key/key" },
  GITHUB_TOKEN: { DATA_KEY: "luke/github-token/data-key", SECRET: "luke/github-token/token" },
  MAC_LAUNCH: { DATA_KEY: "luke/mac-launch/data-key", SECRET: "luke/mac-launch/secrets" },
  SANDBOX_FIREWALL: {
    DATA_KEY: "luke/sandbox-firewall/data-key",
    SECRET: "luke/sandbox-firewall/entries",
  },
  CHATGPT_DEVICE_LOGIN: {
    DATA_KEY: "luke/chatgpt-device-login/data-key",
    SECRET: "luke/chatgpt-device-login/codes",
  },
} as const;

type SealPurpose = (typeof SEAL_PURPOSE)[keyof typeof SEAL_PURPOSE];

const KEY_ENTRY = /^(\d{1,6}):([A-Za-z0-9+/]{43}=)$/u;

const KEY_RING_FAULT = {
  EMPTY: "it names no key",
  MALFORMED: "an entry is not <version>:<base64 of 32 bytes>",
  DUPLICATE: "a version is named twice",
} as const;

export type KeyRingFault = (typeof KEY_RING_FAULT)[keyof typeof KEY_RING_FAULT];

export interface KeyRing {
  readonly current: number;
  readonly keys: ReadonlyMap<number, Redacted.Redacted<Uint8Array>>;
}

export interface SealedProviderKey {
  readonly keyVersion: number;
  readonly sealedDataKey: string;
  readonly sealedKey: string;
}

export interface SealedGitHubToken {
  readonly keyVersion: number;
  readonly sealedDataKey: string;
  readonly sealedToken: string;
}

const SealedColumnSchema = Schema.Struct({
  keyVersion: Schema.Number,
  sealedDataKey: Schema.String,
  sealed: Schema.String,
});

const encodeSealedColumn = Schema.encodeSync(Schema.fromJsonString(SealedColumnSchema));

const decodeSealedColumn = Schema.decodeUnknownResult(Schema.fromJsonString(SealedColumnSchema));

export interface MacLaunchOwner {
  readonly userId: string;
  readonly agentId: string;
}

export interface FirewallOwner {
  readonly userId: string;
  readonly sandboxSessionId: string;
}

export interface DeviceLoginOwner {
  readonly userId: string;
  readonly loginId: string;
}

export interface SealOwner {
  readonly userId: string;
  readonly provider: ProviderKeyProvider;
  readonly kind: ProviderKeyKind;
}

export const PROVIDER_KEY_UNREADABLE = "unreadable";

export type ProviderKeyUnreadable = typeof PROVIDER_KEY_UNREADABLE;

interface WrappedDataKey {
  readonly keyVersion: number;
  readonly sealedDataKey: string;
}

type SealNames = readonly string[];

function additionalData(purpose: string, names: SealNames, version?: number): Buffer {
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
    return undefined;
  }
}

function openDataKey(
  ring: KeyRing,
  purpose: SealPurpose,
  names: SealNames,
  wrapped: WrappedDataKey,
): Buffer | undefined {
  const wrapping = ring.keys.get(wrapped.keyVersion);
  if (wrapping === undefined) return undefined;
  const aad = additionalData(purpose.DATA_KEY, names, wrapped.keyVersion);
  const dataKey = openBytes(Redacted.value(wrapping), wrapped.sealedDataKey, aad);
  return dataKey?.length === SEAL.KEY_BYTES ? dataKey : undefined;
}

function wrapDataKey(
  ring: KeyRing,
  purpose: SealPurpose,
  names: SealNames,
  dataKey: Uint8Array,
): WrappedDataKey {
  const wrapping = ring.keys.get(ring.current);
  if (wrapping === undefined)
    throw new Error("The key ring names a current version it does not hold.");
  const aad = additionalData(purpose.DATA_KEY, names, ring.current);
  return {
    keyVersion: ring.current,
    sealedDataKey: sealBytes(Redacted.value(wrapping), dataKey, aad),
  };
}

function sealSecret(
  ring: KeyRing,
  purpose: SealPurpose,
  names: SealNames,
  secret: Redacted.Redacted<string>,
): WrappedDataKey & { readonly sealed: string } {
  const dataKey = randomBytes(SEAL.KEY_BYTES);
  const sealed = sealBytes(
    dataKey,
    Buffer.from(Redacted.value(secret), "utf8"),
    additionalData(purpose.SECRET, names),
  );
  const wrapped = wrapDataKey(ring, purpose, names, dataKey);
  dataKey.fill(0);
  return { ...wrapped, sealed };
}

function openSecret(
  ring: KeyRing,
  purpose: SealPurpose,
  names: SealNames,
  wrapped: WrappedDataKey,
  sealed: string,
): Redacted.Redacted<string> | undefined {
  const dataKey = openDataKey(ring, purpose, names, wrapped);
  if (dataKey === undefined) return undefined;
  const opened = openBytes(dataKey, sealed, additionalData(purpose.SECRET, names));
  dataKey.fill(0);
  if (opened === undefined) return undefined;
  const secret = Redacted.make(opened.toString("utf8"));
  opened.fill(0);
  return secret;
}

function rewrapSecret(
  ring: KeyRing,
  purpose: SealPurpose,
  names: SealNames,
  wrapped: WrappedDataKey,
): WrappedDataKey | undefined {
  const dataKey = openDataKey(ring, purpose, names, wrapped);
  if (dataKey === undefined) return undefined;
  const rewrapped = wrapDataKey(ring, purpose, names, dataKey);
  dataKey.fill(0);
  return rewrapped;
}

function providerNames(owner: SealOwner): SealNames {
  return owner.kind === PROVIDER_KEY_KIND.API_KEY
    ? [owner.userId, owner.provider]
    : [owner.userId, owner.provider, owner.kind];
}

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

export function sealProviderKey(
  ring: KeyRing,
  owner: SealOwner,
  key: Redacted.Redacted<string>,
): SealedProviderKey {
  const { sealed, ...wrapped } = sealSecret(
    ring,
    SEAL_PURPOSE.PROVIDER_KEY,
    providerNames(owner),
    key,
  );
  return { ...wrapped, sealedKey: sealed };
}

export function openProviderKey(
  ring: KeyRing,
  owner: SealOwner,
  sealed: SealedProviderKey,
): Result.Result<Redacted.Redacted<string>, ProviderKeyUnreadable> {
  const key = openSecret(
    ring,
    SEAL_PURPOSE.PROVIDER_KEY,
    providerNames(owner),
    sealed,
    sealed.sealedKey,
  );
  return key === undefined ? Result.fail(PROVIDER_KEY_UNREADABLE) : Result.succeed(key);
}

export function rewrapProviderKey(
  ring: KeyRing,
  owner: SealOwner,
  sealed: SealedProviderKey,
): Result.Result<SealedProviderKey, ProviderKeyUnreadable> {
  const wrapped = rewrapSecret(ring, SEAL_PURPOSE.PROVIDER_KEY, providerNames(owner), sealed);
  return wrapped === undefined
    ? Result.fail(PROVIDER_KEY_UNREADABLE)
    : Result.succeed({ ...wrapped, sealedKey: sealed.sealedKey });
}

export function sealGitHubToken(
  ring: KeyRing,
  userId: string,
  token: Redacted.Redacted<string>,
): SealedGitHubToken {
  const { sealed, ...wrapped } = sealSecret(ring, SEAL_PURPOSE.GITHUB_TOKEN, [userId], token);
  return { ...wrapped, sealedToken: sealed };
}

export function openGitHubToken(
  ring: KeyRing,
  userId: string,
  sealed: SealedGitHubToken,
): Result.Result<Redacted.Redacted<string>, ProviderKeyUnreadable> {
  const token = openSecret(ring, SEAL_PURPOSE.GITHUB_TOKEN, [userId], sealed, sealed.sealedToken);
  return token === undefined ? Result.fail(PROVIDER_KEY_UNREADABLE) : Result.succeed(token);
}

export function rewrapGitHubToken(
  ring: KeyRing,
  userId: string,
  sealed: SealedGitHubToken,
): Result.Result<SealedGitHubToken, ProviderKeyUnreadable> {
  const wrapped = rewrapSecret(ring, SEAL_PURPOSE.GITHUB_TOKEN, [userId], sealed);
  return wrapped === undefined
    ? Result.fail(PROVIDER_KEY_UNREADABLE)
    : Result.succeed({ ...wrapped, sealedToken: sealed.sealedToken });
}

export function sealMacLaunchSecrets(
  ring: KeyRing,
  owner: MacLaunchOwner,
  secrets: Redacted.Redacted<string>,
): string {
  const sealed = sealSecret(ring, SEAL_PURPOSE.MAC_LAUNCH, [owner.userId, owner.agentId], secrets);
  return encodeSealedColumn(sealed);
}

export function openMacLaunchSecrets(
  ring: KeyRing,
  owner: MacLaunchOwner,
  column: string,
): Result.Result<Redacted.Redacted<string>, ProviderKeyUnreadable> {
  const read = decodeSealedColumn(column);
  if (Result.isFailure(read)) return Result.fail(PROVIDER_KEY_UNREADABLE);
  const secrets = openSecret(
    ring,
    SEAL_PURPOSE.MAC_LAUNCH,
    [owner.userId, owner.agentId],
    read.success,
    read.success.sealed,
  );
  return secrets === undefined ? Result.fail(PROVIDER_KEY_UNREADABLE) : Result.succeed(secrets);
}

export function sealFirewallEntries(
  ring: KeyRing,
  owner: FirewallOwner,
  entries: Redacted.Redacted<string>,
): string {
  const names = [owner.userId, owner.sandboxSessionId];
  return encodeSealedColumn(sealSecret(ring, SEAL_PURPOSE.SANDBOX_FIREWALL, names, entries));
}

export function openFirewallEntries(
  ring: KeyRing,
  owner: FirewallOwner,
  column: string,
): Result.Result<Redacted.Redacted<string>, ProviderKeyUnreadable> {
  const read = decodeSealedColumn(column);
  if (Result.isFailure(read)) return Result.fail(PROVIDER_KEY_UNREADABLE);
  const entries = openSecret(
    ring,
    SEAL_PURPOSE.SANDBOX_FIREWALL,
    [owner.userId, owner.sandboxSessionId],
    read.success,
    read.success.sealed,
  );
  return entries === undefined ? Result.fail(PROVIDER_KEY_UNREADABLE) : Result.succeed(entries);
}

export function sealChatGptDeviceCodes(
  ring: KeyRing,
  owner: DeviceLoginOwner,
  codes: Redacted.Redacted<string>,
): string {
  const names = [owner.userId, owner.loginId];
  return encodeSealedColumn(sealSecret(ring, SEAL_PURPOSE.CHATGPT_DEVICE_LOGIN, names, codes));
}

export function openChatGptDeviceCodes(
  ring: KeyRing,
  owner: DeviceLoginOwner,
  column: string,
): Result.Result<Redacted.Redacted<string>, ProviderKeyUnreadable> {
  const read = decodeSealedColumn(column);
  if (Result.isFailure(read)) return Result.fail(PROVIDER_KEY_UNREADABLE);
  const codes = openSecret(
    ring,
    SEAL_PURPOSE.CHATGPT_DEVICE_LOGIN,
    [owner.userId, owner.loginId],
    read.success,
    read.success.sealed,
  );
  return codes === undefined ? Result.fail(PROVIDER_KEY_UNREADABLE) : Result.succeed(codes);
}
