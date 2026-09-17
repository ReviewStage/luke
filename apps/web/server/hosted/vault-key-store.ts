import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../db/query.js";
import { providerKey } from "../db/vault-schema.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * The encrypted provider-key vault over `effect/unstable/sql`: one ciphertext row
 * per (user, provider). The plaintext never reaches here — the ciphertext a
 * caller hands `storeVaultKey` is already sealed — and storing again for a
 * provider already stored replaces it atomically. There is no read-back of
 * the plaintext anywhere in this module.
 */

type VaultKeyFailure = SqlError | Schema.SchemaError;

/** What a vault seam answers: an effect over the ambient client, composed into the request that read or wrote it. */
export type VaultKeyEffect<A> = Effect.Effect<A, VaultKeyFailure, SqlClient.SqlClient>;

const KeySchema = Schema.Struct({ userId: Schema.String, providerId: Schema.String });

const CiphertextRowSchema = Schema.Struct({ ciphertext: Schema.String });

const findKey = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: CiphertextRowSchema,
  execute: (key) =>
    db
      .select({ ciphertext: providerKey.ciphertext })
      .from(providerKey)
      .where(and(eq(providerKey.userId, key.userId), eq(providerKey.providerId, key.providerId)))
      .limit(1),
});

/** The encrypted key row for this user and provider, or undefined if none stored. */
export function readVaultKey(
  userId: string,
  providerId: string,
): Effect.Effect<{ ciphertext: string } | undefined, VaultKeyFailure, SqlClient.SqlClient> {
  return Effect.map(findKey({ userId, providerId }), Option.getOrUndefined);
}

const StoredKeyRowSchema = Schema.Struct({
  providerId: Schema.String,
  ciphertext: Schema.String,
});

const findKeysForDecryption = SqlSchema.findAll({
  Request: Schema.String,
  Result: StoredKeyRowSchema,
  execute: (userId) =>
    db
      .select({ providerId: providerKey.providerId, ciphertext: providerKey.ciphertext })
      .from(providerKey)
      .where(eq(providerKey.userId, userId)),
});

/** Every vault key row the user has stored, for decryption in the handler. */
export function readStoredVaultKeys(
  userId: string,
): Effect.Effect<
  { providerId: string; ciphertext: string }[],
  VaultKeyFailure,
  SqlClient.SqlClient
> {
  return Effect.map(findKeysForDecryption(userId), (rows) => [...rows]);
}

const KeyListingRowSchema = Schema.Struct({
  providerId: Schema.String,
  updatedAt: InstantColumnSchema,
});

const findKeyListing = SqlSchema.findAll({
  Request: Schema.String,
  Result: KeyListingRowSchema,
  execute: (userId) =>
    db
      .select({ providerId: providerKey.providerId, updatedAt: providerKey.updatedAt })
      .from(providerKey)
      .where(eq(providerKey.userId, userId)),
});

/** What is stored — provider ids and timestamps, never ciphertext. */
export function listVaultKeys(
  userId: string,
): Effect.Effect<{ providerId: string; updatedAt: Date }[], VaultKeyFailure, SqlClient.SqlClient> {
  return Effect.map(findKeyListing(userId), (rows) => [...rows]);
}

const StoreKeySchema = Schema.Struct({
  userId: Schema.String,
  providerId: Schema.String,
  ciphertext: Schema.String,
  updatedAt: Schema.Date,
});

/**
 * Note that the conflicting update sets the values the insert carried rather
 * than reading them back out of `excluded`, because a single-row insert's
 * `excluded` row is exactly those values.
 */
const upsertKey = SqlSchema.void({
  Request: StoreKeySchema,
  execute: (write) =>
    db
      .insert(providerKey)
      .values({
        userId: write.userId,
        providerId: write.providerId,
        ciphertext: write.ciphertext,
        updatedAt: write.updatedAt,
      })
      .onConflictDoUpdate({
        target: [providerKey.userId, providerKey.providerId],
        set: { ciphertext: write.ciphertext, updatedAt: write.updatedAt },
      }),
});

/** Stores a provider's ciphertext, replacing any already stored for the pair. */
export function storeVaultKey(
  userId: string,
  providerId: string,
  ciphertext: string,
): Effect.Effect<void, VaultKeyFailure, SqlClient.SqlClient> {
  return Effect.flatMap(DateTime.nowAsDate, (updatedAt) =>
    upsertKey({ userId, providerId, ciphertext, updatedAt }),
  );
}

const UserIdRowSchema = Schema.Struct({ userId: Schema.String });

const deleteKeyRow = SqlSchema.findAll({
  Request: KeySchema,
  Result: UserIdRowSchema,
  execute: (key) =>
    db
      .delete(providerKey)
      .where(and(eq(providerKey.userId, key.userId), eq(providerKey.providerId, key.providerId)))
      .returning({ userId: providerKey.userId }),
});

/** Deletes the stored key, answering whether one went. */
export function deleteVaultKey(
  userId: string,
  providerId: string,
): Effect.Effect<boolean, VaultKeyFailure, SqlClient.SqlClient> {
  return Effect.map(deleteKeyRow({ userId, providerId }), (rows) => rows.length > 0);
}
