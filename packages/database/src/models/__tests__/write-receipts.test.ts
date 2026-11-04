import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import { keepWriteReceipt, writeReceiptStands } from "../write-receipts.js";

/**
 * The keys an account's writes were taken under, over a real dialect: a key
 * one account kept is found for it and never for another account that
 * sends the same key. Synthetic accounts and keys throughout.
 */

const KEPT_MS = 30 * 24 * 60 * 60_000;

/** A new account, answering its id. */
const openAccount = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  return userId;
});

it.layer(getTestDB())("write receipts", (it) => {
  it.effect("a key one account kept is found for it alone", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const other = yield* openAccount;
      const key = randomUUID();
      yield* keepWriteReceipt(owner, key, KEPT_MS);

      assert.equal(yield* writeReceiptStands(owner, key), true);
      assert.equal(yield* writeReceiptStands(other, key), false);
    }),
  );
});
