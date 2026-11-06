import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import { nativeCallKeyOf } from "../native-call-keys.js";

const WINDOW_MS = 10 * 60_000;

const openConversation = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const [row] = yield* Database.use((db) =>
    db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.AGENT })
      .returning({ id: conversations.id }),
  );
  assert.ok(row);
  return { userId, conversationId: row.id };
});

it.layer(getTestDB())("native call keys", (it) => {
  it.effect(
    "a call of the same input within the window is handed the key the first was given, and one past the window a fresh one",
    () =>
      Effect.gen(function* () {
        const { userId, conversationId } = yield* openConversation;
        const digest = `digest-${randomUUID()}`;
        const first = yield* nativeCallKeyOf(userId, conversationId, digest, WINDOW_MS);
        yield* TestClock.adjust(WINDOW_MS - 1);
        const retried = yield* nativeCallKeyOf(userId, conversationId, digest, WINDOW_MS);
        yield* TestClock.adjust(1);
        const later = yield* nativeCallKeyOf(userId, conversationId, digest, WINDOW_MS);
        const afterLater = yield* nativeCallKeyOf(userId, conversationId, digest, WINDOW_MS);

        assert.equal(retried, first);
        assert.notEqual(later, first);
        assert.equal(afterLater, later);
      }),
  );

  it.effect(
    "another conversation's call of the same input, the account's own or another's, is a call of its own",
    () =>
      Effect.gen(function* () {
        const own = yield* openConversation;
        const other = yield* openConversation;
        const digest = `digest-${randomUUID()}`;
        const first = yield* nativeCallKeyOf(own.userId, own.conversationId, digest, WINDOW_MS);
        const theirs = yield* nativeCallKeyOf(
          other.userId,
          other.conversationId,
          digest,
          WINDOW_MS,
        );
        const sameAccount = yield* nativeCallKeyOf(
          own.userId,
          other.conversationId,
          digest,
          WINDOW_MS,
        );

        assert.notEqual(theirs, first);
        assert.notEqual(sameAccount, first);
        assert.notEqual(sameAccount, theirs);
      }),
  );
});
