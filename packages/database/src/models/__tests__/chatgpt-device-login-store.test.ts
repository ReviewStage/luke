import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CHATGPT_DEVICE_LOGIN } from "@repo/features/provider-key-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  beginChatGptDeviceLogin,
  dropChatGptDeviceLogin,
  settleChatGptDeviceLogin,
  withChatGptDeviceLoginLocked,
} from "../chatgpt-device-login-store.js";

/**
 * An account's pending ChatGPT device-code login, over a real dialect: a
 * start replaces the account's login under a new id, a settled login keeps
 * its outcome and leaves its codes, and one account neither reads, settles,
 * nor drops another's login. The sealed column is opaque text here, as the
 * store holds it. Synthetic accounts, ids, and seals throughout.
 */

const AT = new Date("2026-11-06T01:00:00Z");
const LAPSES = new Date("2026-11-06T01:15:00Z");

const openAccount = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  return userId;
});

/** The login's row as a check reads it, or none. */
const readLogin = (userId: string, loginId: string) =>
  withChatGptDeviceLoginLocked({ userId, loginId }, (row) =>
    Effect.succeed(Option.getOrUndefined(row)),
  );

it.layer(getTestDB())("a pending ChatGPT device-code login", (it) => {
  it.effect(
    "a start replaces the account's login under a new id, and a settled login keeps its outcome and leaves its codes",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        yield* beginChatGptDeviceLogin({ userId, loginId: "login-1" }, "sealed-1", LAPSES, AT);
        yield* beginChatGptDeviceLogin({ userId, loginId: "login-2" }, "sealed-2", LAPSES, AT);

        assert.equal(yield* readLogin(userId, "login-1"), undefined);
        const pending = yield* readLogin(userId, "login-2");
        assert.equal(pending?.sealedCodes, "sealed-2");
        assert.equal(pending?.outcome, null);
        assert.equal(pending?.expiresAt.getTime(), LAPSES.getTime());

        yield* settleChatGptDeviceLogin(
          { userId, loginId: "login-2" },
          CHATGPT_DEVICE_LOGIN.CONNECTED,
        );
        const settled = yield* readLogin(userId, "login-2");
        assert.equal(settled?.outcome, CHATGPT_DEVICE_LOGIN.CONNECTED);
        assert.equal(settled?.sealedCodes, null);

        yield* dropChatGptDeviceLogin({ userId, loginId: "login-2" });
        assert.equal(yield* readLogin(userId, "login-2"), undefined);
      }),
  );

  it.effect("one account neither reads, settles, nor drops another's login", () =>
    Effect.gen(function* () {
      const [owner, other] = [yield* openAccount, yield* openAccount];
      yield* beginChatGptDeviceLogin({ userId: owner, loginId: "login-1" }, "sealed", LAPSES, AT);

      assert.equal(yield* readLogin(other, "login-1"), undefined);
      yield* settleChatGptDeviceLogin(
        { userId: other, loginId: "login-1" },
        CHATGPT_DEVICE_LOGIN.REFUSED,
      );
      yield* dropChatGptDeviceLogin({ userId: other, loginId: "login-1" });

      const standing = yield* readLogin(owner, "login-1");
      assert.equal(standing?.sealedCodes, "sealed");
      assert.equal(standing?.outcome, null);
    }),
  );
});
