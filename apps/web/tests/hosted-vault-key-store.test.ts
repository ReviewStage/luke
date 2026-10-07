import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { CLOUD_AGENT_PROVIDER_ID, PROVIDER_ID } from "../server/core";
import { readStoredVaultKeys } from "../server/hosted/vault-key-store";
import { testSqlClient } from "./support/sql-client";

/**
 * The vault's read over the real migrations: what an account's rows answer,
 * keyed by the account, which is what the two-account case here is for: a row
 * of one account's is never answered to another's read.
 *
 * The ciphertext strings are opaque fixtures and no key of anyone's: this
 * module never seals or opens one, it only carries what a caller already
 * sealed, and nothing here decrypts.
 */

/**
 * The one cloud provider the vault accepts a key for, and a second provider
 * id beside it. The column is a plain provider id rather than a cloud one,
 * and the rows are keyed by the pair whatever the word is.
 */
const VAULT_PROVIDER_ID = CLOUD_AGENT_PROVIDER_ID.CONDUCTOR;
const OTHER_PROVIDER_ID = PROVIDER_ID.CLAUDE_CODE;

/** An opaque stand-in for a sealed key; nothing here reads it as one. */
const CIPHERTEXT = "sealed-one";
const OTHER_CIPHERTEXT = "sealed-two";

const openUser = () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const userId = `user-${randomUUID()}`;
    yield* sql`
      insert into "user" (id, name, email)
      values (${userId}, ${"Vault Fixture"}, ${`${userId}@luke.test`})
    `;
    return userId;
  });

const storeKey = (userId: string, providerId: string, ciphertext: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      insert into provider_key (user_id, provider_id, ciphertext, updated_at)
      values (${userId}, ${providerId}, ${ciphertext}, ${new Date(0)})
    `;
  });

it.layer(testSqlClient)("the vault's key rows", (it) => {
  it.effect("answers every provider the account stored, and none of another account's", () =>
    Effect.gen(function* () {
      const userId = yield* openUser();
      const other = yield* openUser();
      yield* storeKey(userId, VAULT_PROVIDER_ID, CIPHERTEXT);
      yield* storeKey(userId, OTHER_PROVIDER_ID, OTHER_CIPHERTEXT);
      yield* storeKey(other, VAULT_PROVIDER_ID, "sealed-elsewhere");

      const rows = yield* readStoredVaultKeys(userId);
      assert.deepEqual(
        [...rows].sort((left, right) => left.providerId.localeCompare(right.providerId)),
        [
          { providerId: OTHER_PROVIDER_ID, ciphertext: OTHER_CIPHERTEXT },
          { providerId: VAULT_PROVIDER_ID, ciphertext: CIPHERTEXT },
        ],
      );
    }),
  );

  it.effect("answers nothing for an account with no row", () =>
    Effect.gen(function* () {
      const userId = yield* openUser();
      const other = yield* openUser();
      yield* storeKey(other, VAULT_PROVIDER_ID, CIPHERTEXT);

      assert.deepEqual(yield* readStoredVaultKeys(userId), []);
    }),
  );
});
