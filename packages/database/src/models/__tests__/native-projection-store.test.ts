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
import {
  readNativeProjection,
  readNativeSequence,
  withNativeProjection,
} from "../native-projection-store.js";

/**
 * Where a native harness's projection keeps its place, over a real dialect:
 * what one application saves the next reads back, an application that fails
 * keeps nothing, and a conversation another account holds, or one cleared,
 * is never applied to. Synthetic accounts and conversations throughout.
 */

const openConversation = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  // Note that each conversation's runner holds a digest of its own, which the store keeps unique.
  const digest = randomUUID();
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const [row] = yield* db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.CODING_AGENT, runnerTokenHash: digest })
    .returning({ id: conversations.id });
  assert.ok(row);
  return { userId, conversationId: row.id, digest };
});

/** What the conversation's projection reads as now, saving nothing. */
const readBack = (target: { userId: string; conversationId: string; digest: string }) =>
  withNativeProjection(target, target.digest, (held) => Effect.succeed({ result: held }));

it.layer(getTestDB())("the native projection's place", (it) => {
  it.effect("reads nothing before the first save, and what the last save kept after it", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const before = yield* readBack(target);
      yield* withNativeProjection(target, target.digest, () =>
        Effect.succeed({ result: undefined, saved: { sequence: 3, projection: { turn: "t1" } } }),
      );
      const after = yield* readBack(target);
      const sequence = yield* readNativeSequence(target);

      assert.deepEqual(Option.getOrThrow(before), { sequence: null, projection: null });
      assert.deepEqual(sequence, Option.some(3));
      assert.deepEqual(Option.getOrThrow(after), { sequence: 3, projection: { turn: "t1" } });
    }),
  );

  it.effect(
    "the saved projection reads back to the account that holds the conversation, and to no other",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const stranger = yield* openConversation;
        const before = yield* readNativeProjection(target);
        yield* withNativeProjection(target, target.digest, () =>
          Effect.succeed({
            result: undefined,
            saved: { sequence: 2, projection: { turn: { servers: ["linear"] } } },
          }),
        );

        assert.equal(Option.isNone(before), true);
        assert.deepEqual(
          yield* readNativeProjection(target),
          Option.some({ turn: { servers: ["linear"] } }),
        );
        assert.equal(
          Option.isNone(
            yield* readNativeProjection({
              userId: stranger.userId,
              conversationId: target.conversationId,
            }),
          ),
          true,
        );
      }),
  );

  it.effect("an application that fails keeps nothing it wrote or asked to save", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      yield* withNativeProjection(target, target.digest, () =>
        Effect.succeed({ result: undefined, saved: { sequence: 1, projection: {} } }),
      );
      const failed = yield* Effect.exit(
        withNativeProjection(target, target.digest, () =>
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

  it.effect("a runner whose bearer was retired, or replaced, is never applied for", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const target = yield* openConversation;
      yield* db
        .update(conversations)
        .set({ runnerTokenHash: randomUUID() })
        .where(eq(conversations.id, target.conversationId));
      const replaced = yield* withNativeProjection(target, target.digest, () =>
        Effect.succeed({ result: undefined, saved: { sequence: 1, projection: {} } }),
      );
      yield* db
        .update(conversations)
        .set({ runnerTokenHash: null })
        .where(eq(conversations.id, target.conversationId));
      const retired = yield* withNativeProjection(target, target.digest, () =>
        Effect.succeed({ result: undefined, saved: { sequence: 1, projection: {} } }),
      );

      assert.deepEqual([Option.isNone(replaced), Option.isNone(retired)], [true, true]);
      assert.equal(Option.isNone(yield* readNativeSequence(target)), true);
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
        target.digest,
        apply,
      );
      const gone = yield* withNativeProjection(cleared, cleared.digest, apply);
      const untouched = yield* readBack(target);
      const strangers = yield* readNativeSequence({
        userId: stranger.userId,
        conversationId: target.conversationId,
      });

      assert.deepEqual([Option.isNone(crossed), Option.isNone(gone), ran], [true, true, 0]);
      assert.equal(Option.isNone(strangers), true);
      assert.equal(Option.getOrThrow(untouched).sequence, null);
    }),
  );
});
