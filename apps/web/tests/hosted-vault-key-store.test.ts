import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { CLOUD_AGENT_PROVIDER_ID, PROVIDER_ID } from "../server/core";
import {
  deleteVaultKey,
  listVaultKeys,
  readStoredVaultKeys,
  readVaultKey,
  storeVaultKey,
} from "../server/hosted/vault-key-store";
import { testSqlClient } from "./support/sql-client";

/**
 * The vault's own five statements over the real migrations: what one
 * provider's row answers, what an account's rows answer, what the listing
 * answers of them, that storing again for a provider already stored replaces
 * the ciphertext rather than adding a row, and that a delete takes one row
 * and says so. Every one of them is keyed by the account, which is what the
 * two-account cases here are for: a row of one account's is never answered to
 * another's read, replaced by another's write, or taken by another's delete.
 *
 * The ciphertext strings are opaque fixtures and no key of anyone's: this
 * module never seals or opens one, it only carries what a caller already
 * sealed, and nothing here decrypts.
 */

/**
 * The one cloud provider the vault accepts a key for, and a second provider
 * id beside it. The column is a plain provider id rather than a cloud one,
 * and these statements are keyed by the pair whatever the word is, so the
 * second stands for a provider with no row of its own.
 */
const VAULT_PROVIDER_ID = CLOUD_AGENT_PROVIDER_ID.CONDUCTOR;
const OTHER_PROVIDER_ID = PROVIDER_ID.CLAUDE_CODE;

/** An opaque stand-in for a sealed key; nothing here reads it as one. */
const CIPHERTEXT = "sealed-one";
const WRITTEN_AT = Date.parse("2026-09-15T10:00:00.000Z");
const REPLACEMENT = "sealed-two";

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

it.layer(testSqlClient)("the vault's key rows", (it) => {
  it.effect("answers a stored provider's ciphertext, and nothing for a provider with no row", () =>
    Effect.gen(function* () {
      const userId = yield* openUser();
      yield* storeVaultKey(userId, VAULT_PROVIDER_ID, CIPHERTEXT);

      assert.deepEqual(yield* readVaultKey(userId, VAULT_PROVIDER_ID), { ciphertext: CIPHERTEXT });
      assert.equal(yield* readVaultKey(userId, OTHER_PROVIDER_ID), undefined);
    }),
  );

  it.effect("answers nothing for another account's stored provider", () =>
    Effect.gen(function* () {
      const userId = yield* openUser();
      const other = yield* openUser();
      yield* storeVaultKey(other, VAULT_PROVIDER_ID, CIPHERTEXT);

      assert.equal(yield* readVaultKey(userId, VAULT_PROVIDER_ID), undefined);
    }),
  );

  it.effect(
    "storing again for a provider already stored replaces the ciphertext on the one row",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser();
        yield* storeVaultKey(userId, VAULT_PROVIDER_ID, CIPHERTEXT);
        yield* storeVaultKey(userId, VAULT_PROVIDER_ID, REPLACEMENT);

        assert.deepEqual(yield* readStoredVaultKeys(userId), [
          { providerId: VAULT_PROVIDER_ID, ciphertext: REPLACEMENT },
        ]);
      }),
  );

  it.effect("answers every provider the account stored, and none of another account's", () =>
    Effect.gen(function* () {
      const userId = yield* openUser();
      const other = yield* openUser();
      yield* storeVaultKey(userId, VAULT_PROVIDER_ID, CIPHERTEXT);
      yield* storeVaultKey(userId, OTHER_PROVIDER_ID, REPLACEMENT);
      yield* storeVaultKey(other, VAULT_PROVIDER_ID, "sealed-elsewhere");

      const rows = yield* readStoredVaultKeys(userId);
      assert.deepEqual(
        [...rows].sort((left, right) => left.providerId.localeCompare(right.providerId)),
        [
          { providerId: OTHER_PROVIDER_ID, ciphertext: REPLACEMENT },
          { providerId: VAULT_PROVIDER_ID, ciphertext: CIPHERTEXT },
        ],
      );
    }),
  );

  it.effect(
    "the listing names the provider and when it was written, and never the ciphertext",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser();
        yield* TestClock.setTime(WRITTEN_AT);
        yield* storeVaultKey(userId, VAULT_PROVIDER_ID, CIPHERTEXT);

        const listing = yield* listVaultKeys(userId);
        assert.equal(listing.length, 1);
        const [row] = listing;
        assert.equal(row?.providerId, VAULT_PROVIDER_ID);
        assert.ok(row !== undefined && row.updatedAt instanceof Date);
        // The row is stamped by the write above, from the clock the test set.
        assert.equal(row?.updatedAt.getTime(), WRITTEN_AT);
        assert.deepEqual(Object.keys(row ?? {}).sort(), ["providerId", "updatedAt"]);
      }),
  );

  it.effect("a delete takes the account's own row and says so; a second says nothing went", () =>
    Effect.gen(function* () {
      const userId = yield* openUser();
      yield* storeVaultKey(userId, VAULT_PROVIDER_ID, CIPHERTEXT);

      assert.equal(yield* deleteVaultKey(userId, VAULT_PROVIDER_ID), true);
      assert.equal(yield* readVaultKey(userId, VAULT_PROVIDER_ID), undefined);
      assert.equal(yield* deleteVaultKey(userId, VAULT_PROVIDER_ID), false);
    }),
  );

  it.effect("a delete leaves another account's row for the same provider standing", () =>
    Effect.gen(function* () {
      const userId = yield* openUser();
      const other = yield* openUser();
      yield* storeVaultKey(userId, VAULT_PROVIDER_ID, CIPHERTEXT);
      yield* storeVaultKey(other, VAULT_PROVIDER_ID, REPLACEMENT);

      assert.equal(yield* deleteVaultKey(userId, VAULT_PROVIDER_ID), true);
      assert.deepEqual(yield* readVaultKey(other, VAULT_PROVIDER_ID), { ciphertext: REPLACEMENT });
    }),
  );
});
