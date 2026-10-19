import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { INBOX_IMAGE_TYPE } from "@luke/features/inbox-wire";
import { eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { Database } from "../../core/query.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import { attachment } from "../attachment.js";
import { user } from "../auth.js";
import { conversations } from "../storage.js";

/**
 * A conversation's picture as a row of `attachment`, ahead of the move that
 * copies the pictures in: it carries its hash and its size in pixels, the
 * conversation keeps one row per hash, and the row goes with its
 * conversation. Synthetic accounts and bytes throughout.
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

it.layer(getTestDB())("a conversation's picture in attachment", (it) => {
  it.effect(
    "is kept with its hash and size, once per hash in its conversation, refused without either, and goes with its conversation",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { userId, conversationId } = yield* openConversation;
        const picture = {
          userId,
          conversationId,
          sha256: "c".repeat(64),
          contentType: INBOX_IMAGE_TYPE.PNG,
          width: 1200,
          height: 720,
          byteCount: 4,
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          createdAt: new Date(0),
        };

        yield* db.insert(attachment).values(picture);
        const again = yield* db
          .insert(attachment)
          .values(picture)
          .onConflictDoNothing({ target: [attachment.conversationId, attachment.sha256] })
          .returning({ id: attachment.id });
        assert.deepEqual(again, []);
        const unsized = yield* Effect.exit(
          db.insert(attachment).values({ ...picture, sha256: "d".repeat(64), width: null }),
        );
        assert.ok(Exit.isFailure(unsized), "a conversation's picture without its size is refused");

        yield* db.delete(conversations).where(eq(conversations.id, conversationId));
        const left = yield* db
          .select({ id: attachment.id })
          .from(attachment)
          .where(eq(attachment.conversationId, conversationId));
        assert.deepEqual(left, []);
      }),
  );
});
