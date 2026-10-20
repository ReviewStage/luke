import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import { withNativeProjection } from "../native-projection-store.js";

/**
 * Where a native harness's projection keeps its place, over a real dialect:
 * what one application saves the next reads back, an application that fails
 * keeps nothing, and a conversation another account holds, or one cleared,
 * is never applied to. Synthetic accounts and conversations throughout.
 */

const openConversation = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const [row] = yield* db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.CODING_AGENT })
    .returning({ id: conversations.id });
  assert.ok(row);
  return { userId, conversationId: row.id };
});

/** What the conversation's projection reads as now, saving nothing. */
const readBack = (target: { userId: string; conversationId: string }) =>
  withNativeProjection(target, (held) => Effect.succeed({ result: held }));

it.layer(getTestDB())("the native projection's place", (it) => {
  it.effect("reads nothing before the first save, and what the last save kept after it", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const before = yield* readBack(target);
      yield* withNativeProjection(target, () =>
        Effect.succeed({ result: undefined, saved: { sequence: 3, projection: { turn: "t1" } } }),
      );
      const after = yield* readBack(target);

      assert.deepEqual(Option.getOrThrow(before), { sequence: null, projection: null });
      assert.deepEqual(Option.getOrThrow(after), { sequence: 3, projection: { turn: "t1" } });
    }),
  );

  it.effect("an application that fails keeps nothing it wrote or asked to save", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      yield* withNativeProjection(target, () =>
        Effect.succeed({ result: undefined, saved: { sequence: 1, projection: {} } }),
      );
      const failed = yield* Effect.exit(
        withNativeProjection(target, () =>
          Effect.andThen(
            Effect.flatMap(Database, (db) =>
              db
                .update(conversations)
                .set({ nativeSequence: 9 })
                .where(eq(conversations.id, target.conversationId)),
            ),
            Effect.fail("refused"),
          ),
        ),
      );
      const after = yield* readBack(target);

      assert.equal(failed._tag, "Failure");
      assert.equal(Option.getOrThrow(after).sequence, 1);
    }),
  );

  it.effect("a conversation another account holds, or one cleared, is never applied to", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const target = yield* openConversation;
      const stranger = yield* openConversation;
      const cleared = yield* openConversation;
      yield* db
        .update(conversations)
        .set({ deletedAt: new Date() })
        .where(eq(conversations.id, cleared.conversationId));
      let ran = 0;
      const apply = () =>
        Effect.sync(() => {
          ran += 1;
          return { result: undefined, saved: { sequence: 5, projection: {} } };
        });

      const crossed = yield* withNativeProjection(
        { userId: stranger.userId, conversationId: target.conversationId },
        apply,
      );
      const gone = yield* withNativeProjection(cleared, apply);
      const untouched = yield* readBack(target);

      assert.deepEqual([Option.isNone(crossed), Option.isNone(gone), ran], [true, true, 0]);
      assert.equal(Option.getOrThrow(untouched).sequence, null);
    }),
  );
});
