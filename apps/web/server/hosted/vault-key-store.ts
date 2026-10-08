import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../db/query.js";
import { providerKey } from "../db/vault-schema.js";

/**
 * The encrypted provider-key vault over `effect/unstable/sql`: one ciphertext row
 * per (user, provider), read here for the scheduled pass to open. The
 * plaintext never reaches here, and there is no read-back of it anywhere in
 * this module.
 */

type VaultKeyFailure = SqlError | Schema.SchemaError;

/** What a vault seam answers: an effect over the ambient client, composed into the request that read or wrote it. */
export type VaultKeyEffect<A> = Effect.Effect<A, VaultKeyFailure, SqlClient.SqlClient>;

/** Stored vault key row as the pass reads it. */
export interface VaultKeyRow {
  providerId: string;
  ciphertext: string;
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
): Effect.Effect<VaultKeyRow[], VaultKeyFailure, SqlClient.SqlClient> {
  return Effect.map(findKeysForDecryption(userId), (rows) => [...rows]);
}
