import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CONVERSATION_PICTURE_BOUNDS } from "@luke/features/conversation-picture-wire";
import { INBOX_IMAGE_TYPE } from "@luke/features/inbox-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { attachment } from "../../schemas/attachment.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  keepConversationPicture,
  type PictureToKeep,
  readConversationPicture,
} from "../conversation-pictures.js";
import type { ConversationTarget } from "../writer.js";

/**
 * The pictures a conversation's tools answered, over a real dialect: the
 * same bytes are kept once per conversation and answered as the same row,
 * another conversation keeps and reads only its own, and a picture that
 * would take its conversation past its bytes is not kept.
 *
 * Synthetic accounts and bytes throughout: no picture is a real one.
 */

/** A synthetic picture, its bytes told apart by `mark`; the store keeps what it is handed and sniffs nothing. */
function picture(mark: number): PictureToKeep {
  return {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, mark % 256, Math.floor(mark / 256)]),
    contentType: INBOX_IMAGE_TYPE.PNG,
    width: 1200,
    height: 720,
  };
}

const openConversation = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const [row] = yield* db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.CODING_AGENT })
    .returning({ id: conversations.id });
  assert.ok(row);
  const target: ConversationTarget = { userId, conversationId: row.id };
  return target;
});

it.layer(getTestDB())("a conversation's pictures", (it) => {
  it.effect("the same bytes are one picture, read back through their own conversation alone", () =>
    Effect.gen(function* () {
      const owner = yield* openConversation;
      const other = yield* openConversation;

      const first = yield* keepConversationPicture(owner, picture(1));
      const again = yield* keepConversationPicture(owner, picture(1));
      const elsewhere = yield* keepConversationPicture(other, picture(1));

      assert.ok(Option.isSome(first) && Option.isSome(again) && Option.isSome(elsewhere));
      assert.deepEqual(again.value, first.value, "a picture handed in twice is the row kept first");
      assert.notEqual(elsewhere.value.id, first.value.id, "another conversation keeps its own");
      assert.deepEqual(
        { ...first.value, id: "" },
        { id: "", mediaType: INBOX_IMAGE_TYPE.PNG, width: 1200, height: 720, byteCount: 6 },
      );
      const read = yield* readConversationPicture(owner.conversationId, first.value.id);
      assert.deepEqual(
        Option.map(read, (stored) => [stored.contentType, [...stored.bytes]]),
        Option.some([INBOX_IMAGE_TYPE.PNG, [...picture(1).bytes]]),
      );
      assert.deepEqual(
        yield* readConversationPicture(other.conversationId, first.value.id),
        Option.none(),
        "a picture is not read through another account's conversation",
      );
    }),
  );

  it.effect("a picture that would take its conversation past its bytes is not kept", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const kept = yield* keepConversationPicture(target, picture(0));
      // Note that the row stands in for pictures kept up to the budget's last few bytes, because
      // the budget is read off the rows' byte counts and two hundred megabytes of real bytes
      // would only slow the test.
      const db = yield* Database;
      yield* db.insert(attachment).values({
        userId: target.userId,
        conversationId: target.conversationId,
        sha256: "f".repeat(64),
        contentType: INBOX_IMAGE_TYPE.PNG,
        width: 1,
        height: 1,
        byteCount: CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION - 10,
        bytes: new Uint8Array([0]),
        createdAt: new Date(),
      });

      const past = yield* keepConversationPicture(target, picture(1));
      const keptAlready = yield* keepConversationPicture(target, picture(0));

      assert.deepEqual(past, Option.none());
      assert.deepEqual(keptAlready, kept, "a picture kept before the budget is still answered");
    }),
  );
});
