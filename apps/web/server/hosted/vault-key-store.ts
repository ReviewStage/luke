import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";

/**
 * The encrypted provider-key vault over `@effect/sql`: one ciphertext row
 * per (user, provider). The plaintext never reaches here — the ciphertext a
 * caller hands `storeVaultKey` is already sealed — and storing again for a
 * provider already stored replaces it atomically. There is no read-back of
 * the plaintext anywhere in this module.
 */

type VaultKeyFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const KeySchema = Schema.Struct({ userId: Schema.String, providerId: Schema.String });

const CiphertextRowSchema = Schema.Struct({ ciphertext: Schema.String });

const findKey = SqlSchema.findOne({
  Request: KeySchema,
  Result: CiphertextRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select ciphertext from provider_key
        where user_id = ${key.userId} and provider_id = ${key.providerId}
        limit 1
      `,
    ),
});

/** The encrypted key row for this user and provider, or undefined if none stored. */
export function readVaultKey(
  userId: string,
  providerId: string,
): Effect.Effect<{ ciphertext: string } | undefined, VaultKeyFailure, SqlClient.SqlClient> {
  return Effect.map(findKey({ userId, providerId }), Option.getOrUndefined);
}

const StoredKeyRowSchema = Schema.Struct({
  providerId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("provider_id")),
  ciphertext: Schema.String,
});

const findKeysForDecryption = SqlSchema.findAll({
  Request: Schema.String,
  Result: StoredKeyRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`select provider_id, ciphertext from provider_key where user_id = ${userId}`,
    ),
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
  providerId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("provider_id")),
  updatedAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("updated_at")),
});

const findKeyListing = SqlSchema.findAll({
  Request: Schema.String,
  Result: KeyListingRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`select provider_id, updated_at from provider_key where user_id = ${userId}`,
    ),
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
  updatedAt: Schema.DateFromSelf,
});

const upsertKey = SqlSchema.void({
  Request: StoreKeySchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into provider_key (user_id, provider_id, ciphertext, updated_at)
        values (${write.userId}, ${write.providerId}, ${write.ciphertext}, ${write.updatedAt})
        on conflict (user_id, provider_id) do update
          set ciphertext = excluded.ciphertext, updated_at = excluded.updated_at
      `,
    ),
});

/** Stores a provider's ciphertext, replacing any already stored for the pair. */
export function storeVaultKey(
  userId: string,
  providerId: string,
  ciphertext: string,
): Effect.Effect<void, VaultKeyFailure, SqlClient.SqlClient> {
  return upsertKey({ userId, providerId, ciphertext, updatedAt: new Date() });
}

const UserIdRowSchema = Schema.Struct({
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
});

const deleteKeyRow = SqlSchema.findAll({
  Request: KeySchema,
  Result: UserIdRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        delete from provider_key
        where user_id = ${key.userId} and provider_id = ${key.providerId}
        returning user_id
      `,
    ),
});

/** Deletes the stored key, answering whether one went. */
export function deleteVaultKey(
  userId: string,
  providerId: string,
): Effect.Effect<boolean, VaultKeyFailure, SqlClient.SqlClient> {
  return Effect.map(deleteKeyRow({ userId, providerId }), (rows) => rows.length > 0);
}
