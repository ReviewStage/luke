/**
 * connect-token-cache.ts -- Vercel Connect's tokens shared across function instances, sealed, until shortly before each expires.
 *
 * Every instance that asks Connect for an account's token pays for the ask,
 * and an agent's launch lands on whichever instance is warm, so the SDK's
 * in-process cache alone misses more often than it hits. This keeps each
 * token Connect issues in Vercel's Runtime Cache, which every instance of
 * this project in a region reads, and which never outlives its entry's TTL
 * or a purge. The cache is ephemeral and no copy of it is Luke's: nothing
 * here writes a token to Postgres, a log line, a trace, or a counted event.
 *
 * Note that the cache never sees a token, a subject, or a connector in the
 * clear, because a store outside this deployment is no place a credential's
 * plaintext may stand. Each entry is sealed under AES-256-GCM with the
 * connector and subject bound as additional data, so an entry read under
 * another account's key fails its tag rather than opening; its key and its
 * tag are HMACs of the connector and subject, so neither names a user in
 * Vercel's dashboard, and the SDK's own key hash (32-bit, where a collision
 * would hand one account another's token) and its habit of sending the key
 * as the entry's name are both refused. The keys that seal and name entries
 * are derived from the current version of the deployment's provider-key ring
 * (`provider-key-seal.ts`) under purposes of their own, so a rotation of the
 * ring leaves every standing entry unreadable and it simply misses; a
 * deployment without the ring shares nothing and asks Connect as before.
 *
 * An entry lives until a minute before its token expires and never longer
 * than an hour, so a grant revoked at the provider itself, which Luke is
 * never told of, is not handed out past that. A cache that cannot be
 * reached answers nothing: every step here fails into asking Connect, never
 * into an error.
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { parseKeyRing } from "@luke/database/models/provider-key-seal";
import { getCache } from "@vercel/functions";
import { Clock, Context, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { HostedEnvironment } from "../environment.js";
import type { IntegrationToken } from "./integration-connect.js";

/** How close to its expiry a token is no longer handed out of the cache, nor written to it. */
const EXPIRY_MARGIN_MS = 60_000;

/** The longest an entry lives, whatever its token's own expiry. */
const ENTRY_LIFETIME_MAX_MS = 3_600_000;

/** The shortest TTL worth a write, since the store counts its TTL in whole seconds. */
const ENTRY_LIFETIME_MIN_MS = 1_000;

/** What each derived key and each digest is for, so one never stands in for another. */
const CACHE_PURPOSE = {
  SEAL_KEY: "luke/connect-token-cache/seal",
  NAME_KEY: "luke/connect-token-cache/name",
  ENTRY_KEY: "entry",
  ENTRY_TAG: "tag",
  SEALED: "luke/connect-token-cache/token",
} as const;

const SEAL = {
  ALGORITHM: "aes-256-gcm",
  KEY_BYTES: 32,
  NONCE_BYTES: 12,
  TAG_BYTES: 16,
} as const;

/** The namespace every entry's key stands under in the project's Runtime Cache. */
const CACHE_NAMESPACE = "connect-token";

/** What a sealed entry opens to: the token as Connect issued it. */
const CachedToken = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.Number,
  accountName: Schema.optional(Schema.String),
});

const decodeCachedToken = Schema.decodeUnknownOption(Schema.fromJsonString(CachedToken));

/** The calls of a shared store this cache makes: Vercel's Runtime Cache, or a store a test hands it. */
export interface ConnectTokenStore {
  readonly get: (key: string) => Promise<unknown>;
  readonly set: (
    key: string,
    value: string,
    options: { readonly ttl: number; readonly tags: readonly string[] },
  ) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
  readonly expireTag: (tag: string) => Promise<void>;
}

/** The token cache a connector reads through: none of its steps can fail. */
export interface ConnectTokenCacheService {
  /** The token cached for the account under `subject` at `connector`, where one stands with more than a minute left. */
  readonly read: (
    connector: string,
    subject: string,
  ) => Effect.Effect<Option.Option<IntegrationToken>>;
  /** Keeps a token Connect just issued, until a minute before it expires and at most an hour. */
  readonly write: (
    connector: string,
    subject: string,
    token: IntegrationToken,
  ) => Effect.Effect<void>;
  /** Drops whatever is cached for the account, as a revoke or a new sign-in asks. */
  readonly forget: (connector: string, subject: string) => Effect.Effect<void>;
}

export class ConnectTokenCache extends Context.Service<
  ConnectTokenCache,
  ConnectTokenCacheService
>()("ConnectTokenCache") {}

/** The cache of a deployment that shares no token: every read misses, and nothing is kept. */
export const NO_CONNECT_TOKEN_CACHE: ConnectTokenCacheService = {
  read: () => Effect.succeed(Option.none()),
  write: () => Effect.void,
  forget: () => Effect.void,
};

/** The two keys derived from the ring's current key: one seals entries, one names them. */
interface CacheKeys {
  readonly seal: Redacted.Redacted<Uint8Array>;
  readonly name: Redacted.Redacted<Uint8Array>;
}

/** Vercel's Runtime Cache, with the keys this module computes passed through as they are and no entry name sent. */
function runtimeCacheStore(): ConnectTokenStore {
  const cache = getCache({ namespace: CACHE_NAMESPACE, keyHashFunction: (key: string) => key });
  return {
    get: (key) => cache.get(key),
    set: (key, value, { ttl, tags }) => cache.set(key, value, { ttl, tags: [...tags], name: "" }),
    delete: (key) => cache.delete(key),
    expireTag: (tag) => cache.expireTag(tag),
  };
}

/** The keys the ring's current version derives, or none where the deployment holds no ring it can read. */
function cacheKeysOf(ring: Redacted.Redacted | undefined): CacheKeys | undefined {
  if (ring === undefined) return undefined;
  const parsed = parseKeyRing(ring);
  if (Result.isFailure(parsed)) return undefined;
  const current = parsed.success.keys.get(parsed.success.current);
  if (current === undefined) return undefined;
  const derive = (purpose: string) =>
    Redacted.make(
      new Uint8Array(
        hkdfSync("sha256", Redacted.value(current), new Uint8Array(0), purpose, SEAL.KEY_BYTES),
      ),
    );
  return { seal: derive(CACHE_PURPOSE.SEAL_KEY), name: derive(CACHE_PURPOSE.NAME_KEY) };
}

/** One account's grant as every digest and seal binds it: what the digest is for, the connector, and the subject. */
function bound(purpose: string, connector: string, subject: string): string {
  return JSON.stringify([purpose, connector, subject]);
}

/** A digest naming one account's entry or tag, which says nothing of whose it is. */
function digestOf(keys: CacheKeys, purpose: string, connector: string, subject: string): string {
  return createHmac("sha256", Redacted.value(keys.name))
    .update(bound(purpose, connector, subject))
    .digest("hex");
}

/** The token sealed for one account's entry: base64 of nonce, ciphertext, and tag. */
function sealToken(
  keys: CacheKeys,
  connector: string,
  subject: string,
  token: IntegrationToken,
): string {
  const nonce = randomBytes(SEAL.NONCE_BYTES);
  const cipher = createCipheriv(SEAL.ALGORITHM, Redacted.value(keys.seal), nonce, {
    authTagLength: SEAL.TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(bound(CACHE_PURPOSE.SEALED, connector, subject)));
  const plaintext = JSON.stringify({
    token: Redacted.value(token.token),
    expiresAt: token.expiresAt,
    ...(token.accountName !== undefined ? { accountName: token.accountName } : undefined),
  });
  const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, sealed, cipher.getAuthTag()]).toString("base64");
}

/** The token one account's entry opens to, or none where it is not this account's, was tampered with, or is no entry at all. */
function openToken(
  keys: CacheKeys,
  connector: string,
  subject: string,
  entry: unknown,
): Option.Option<IntegrationToken> {
  if (typeof entry !== "string") return Option.none();
  const bytes = Buffer.from(entry, "base64");
  if (bytes.length <= SEAL.NONCE_BYTES + SEAL.TAG_BYTES) return Option.none();
  try {
    const decipher = createDecipheriv(
      SEAL.ALGORITHM,
      Redacted.value(keys.seal),
      bytes.subarray(0, SEAL.NONCE_BYTES),
      { authTagLength: SEAL.TAG_BYTES },
    );
    decipher.setAAD(Buffer.from(bound(CACHE_PURPOSE.SEALED, connector, subject)));
    decipher.setAuthTag(bytes.subarray(bytes.length - SEAL.TAG_BYTES));
    const opened = Buffer.concat([
      decipher.update(bytes.subarray(SEAL.NONCE_BYTES, bytes.length - SEAL.TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
    return Option.map(decodeCachedToken(opened), (read) => ({
      token: Redacted.make(read.token),
      expiresAt: read.expiresAt,
      ...(read.accountName !== undefined ? { accountName: read.accountName } : undefined),
    }));
  } catch {
    // Note that every failure to open is a miss, because a wrong key and a tampered byte are both an entry not to use.
    return Option.none();
  }
}

/** One of the store's calls as an effect that cannot fail: a store that throws or refuses is a store that answered nothing. */
function storeCall<A>(call: () => Promise<A>): Effect.Effect<Option.Option<A>> {
  return Effect.tryPromise(call).pipe(
    Effect.map(Option.some),
    Effect.orElseSucceed(() => Option.none()),
  );
}

/**
 * The token cache over a shared store, sealed under keys the ring's current
 * version derives; with no ring it can read, the cache shares nothing.
 */
export function connectTokenCacheOver(
  ring: Redacted.Redacted | undefined,
  store: ConnectTokenStore,
): ConnectTokenCacheService {
  const keys = cacheKeysOf(ring);
  if (keys === undefined) return NO_CONNECT_TOKEN_CACHE;
  const keyOf = (connector: string, subject: string) =>
    digestOf(keys, CACHE_PURPOSE.ENTRY_KEY, connector, subject);
  const tagOf = (connector: string, subject: string) =>
    digestOf(keys, CACHE_PURPOSE.ENTRY_TAG, connector, subject);
  return {
    read: (connector, subject) =>
      Effect.gen(function* () {
        const entry = yield* storeCall(() => store.get(keyOf(connector, subject)));
        const now = yield* Clock.currentTimeMillis;
        return Option.filter(
          Option.flatMap(entry, (read) => openToken(keys, connector, subject, read)),
          (token) => token.expiresAt - now > EXPIRY_MARGIN_MS,
        );
      }),
    write: (connector, subject, token) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const lifetime = Math.min(token.expiresAt - now - EXPIRY_MARGIN_MS, ENTRY_LIFETIME_MAX_MS);
        if (!(lifetime >= ENTRY_LIFETIME_MIN_MS)) return;
        const sealed = sealToken(keys, connector, subject, token);
        yield* storeCall(() =>
          store.set(keyOf(connector, subject), sealed, {
            ttl: Math.floor(lifetime / 1000),
            tags: [tagOf(connector, subject)],
          }),
        );
      }),
    // Note that both are asked, because a delete reaches this region's cache alone and a tag's expiry reaches every region within a second.
    forget: (connector, subject) =>
      Effect.asVoid(
        Effect.all(
          [
            storeCall(() => store.delete(keyOf(connector, subject))),
            storeCall(() => store.expireTag(tagOf(connector, subject))),
          ],
          { concurrency: "unbounded" },
        ),
      ),
  };
}

/** The token cache over this project's Runtime Cache, sealed under the deployment's provider-key ring. */
export const connectTokenCacheFromEnvironment: Layer.Layer<
  ConnectTokenCache,
  never,
  HostedEnvironment
> = Layer.effect(
  ConnectTokenCache,
  Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    return connectTokenCacheOver(environment.providerKeyEncryptionKeys, runtimeCacheStore());
  }),
);
