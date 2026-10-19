import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { readConversationPicture } from "@luke/database/models/conversation-pictures";
import type { ConversationTarget } from "@luke/database/models/writer";
import { attachment } from "@luke/database/schemas/attachment";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB } from "@luke/database/testing";
import { CONVERSATION_PICTURE_BOUNDS } from "@luke/features/conversation-picture-wire";
import { INBOX_IMAGE_TYPE } from "@luke/features/inbox-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { ACTION_RESULT_STATUS } from "../../core.js";
import { runShowImage, SHOW_IMAGE_REFUSAL, type ShowImageBinding } from "./show-image.js";

/**
 * show-image.test.ts -- a coding agent's pictures shown from its sandbox
 * over a real dialect: each file read and kept beside the transcript the
 * call is written to, in order, and named by id; a call with a file that is
 * missing, no picture, or too large shows nothing and says why, naming the
 * path; and a transcript that keeps as many pictures as it may shows no
 * more.
 *
 * Synthetic files throughout: a picture is a PNG's signature and header,
 * which states its size, and nothing more.
 */

const CHECKOUT = "/vercel/sandbox/repository";

/** A PNG's signature and header chunk, stating the size given; the store and the reader read no further. */
function png(width: number, height: number, mark = 0): Uint8Array {
  const header = new Uint8Array(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(header.buffer).setUint32(16, width);
  new DataView(header.buffer).setUint32(20, height);
  header[32] = mark;
  return header;
}

/** A sandbox holding the files given by absolute path, each read as one stream. */
function sandboxWith(files: Readonly<Record<string, Uint8Array>>): ShowImageBinding["sandbox"] {
  return () =>
    Promise.resolve({
      readFile: ({ path }: { path: string }) => {
        const bytes = files[path];
        if (bytes === undefined) return Promise.resolve(null);
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        );
      },
    });
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

const readShown = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Literal(ACTION_RESULT_STATUS.ACCEPTED),
    pictures: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        mediaType: Schema.String,
        width: Schema.Number,
        height: Schema.Number,
        byteCount: Schema.Number,
      }),
    ),
  }),
);

const refused = (reason: string) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason });

const show = (binding: ShowImageBinding, input: WireBoundaryInput) =>
  runShowImage(binding, unparsedWire(input));

it.layer(getTestDB())("show_image", (it) => {
  it.effect(
    "each file is kept beside the transcript in order, named by its id, type, and size, and read back as its bytes",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const sandbox = sandboxWith({
          [`${CHECKOUT}/shots/members.png`]: png(1200, 720),
          "/tmp/accept.png": png(390, 700),
        });

        const answer = readShown(
          yield* show(
            { target, sandbox, checkout: CHECKOUT },
            {
              images: [
                { path: "shots/members.png", caption: "Members page" },
                { path: "/tmp/accept.png", caption: "Accept page" },
              ],
            },
          ),
        );

        assert.deepEqual(
          answer.pictures.map(({ mediaType, width, height, byteCount }) => [
            mediaType,
            width,
            height,
            byteCount,
          ]),
          [
            [INBOX_IMAGE_TYPE.PNG, 1200, 720, 33],
            [INBOX_IMAGE_TYPE.PNG, 390, 700, 33],
          ],
        );
        const [first] = answer.pictures;
        assert.ok(first);
        const read = yield* readConversationPicture(target.conversationId, first.id);
        assert.deepEqual(
          Option.map(read, (stored) => [...stored.bytes]),
          Option.some([...png(1200, 720)]),
        );
      }),
  );

  it.effect(
    "a call naming a missing file, a file that is no picture, or one too large shows nothing and names the path",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const tooLarge = new Uint8Array(CONVERSATION_PICTURE_BOUNDS.MAX_BYTES + 1);
        tooLarge.set(png(10, 10));
        const sandbox = sandboxWith({
          [`${CHECKOUT}/ok.png`]: png(10, 10),
          [`${CHECKOUT}/notes.txt`]: new TextEncoder().encode("not a picture at all"),
          [`${CHECKOUT}/huge.png`]: tooLarge,
        });
        const binding = { target, sandbox, checkout: CHECKOUT };
        const withSecond = (path: string) => ({
          images: [
            { path: "ok.png", caption: "Kept only if every file is" },
            { path, caption: "The second" },
          ],
        });

        assert.deepEqual(
          yield* show(binding, withSecond("gone.png")),
          refused(`${SHOW_IMAGE_REFUSAL.NO_FILE} gone.png`),
        );
        assert.deepEqual(
          yield* show(binding, withSecond("notes.txt")),
          refused(`${SHOW_IMAGE_REFUSAL.NOT_IMAGE} notes.txt`),
        );
        assert.deepEqual(
          yield* show(binding, withSecond("huge.png")),
          refused(`${SHOW_IMAGE_REFUSAL.TOO_LARGE} huge.png`),
        );
        const db = yield* Database;
        const kept = yield* db
          .select({ id: attachment.id })
          .from(attachment)
          .where(eq(attachment.conversationId, target.conversationId));
        assert.deepEqual(kept, [], "the file read before a refused one is not kept either");
      }),
  );

  it.effect(
    "a call of no images, or of more than a set may hold, is refused in the tool's words",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const binding = { target, sandbox: sandboxWith({}), checkout: CHECKOUT };
        const many = Array.from(
          { length: CONVERSATION_PICTURE_BOUNDS.MAX_PER_CALL + 1 },
          (_, at) => ({
            path: `shot-${String(at)}.png`,
            caption: "One of too many",
          }),
        );

        assert.deepEqual(
          yield* show(binding, { images: [] }),
          refused(SHOW_IMAGE_REFUSAL.UNREADABLE),
        );
        assert.deepEqual(
          yield* show(binding, { images: many }),
          refused(SHOW_IMAGE_REFUSAL.UNREADABLE),
        );
      }),
  );

  it.effect("a transcript that keeps as many pictures as it may shows no more", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const db = yield* Database;
      // Note that the row stands in for pictures kept up to the budget, because two hundred
      // megabytes of real bytes would only slow the test.
      yield* db.insert(attachment).values({
        userId: target.userId,
        conversationId: target.conversationId,
        sha256: "f".repeat(64),
        contentType: INBOX_IMAGE_TYPE.PNG,
        width: 1,
        height: 1,
        byteCount: CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION,
        bytes: new Uint8Array([0]),
        createdAt: new Date(),
      });
      const binding = {
        target,
        sandbox: sandboxWith({ [`${CHECKOUT}/one.png`]: png(10, 10) }),
        checkout: CHECKOUT,
      };

      assert.deepEqual(
        yield* show(binding, { images: [{ path: "one.png", caption: "One more" }] }),
        refused(SHOW_IMAGE_REFUSAL.FULL),
      );
    }),
  );

  it.effect(
    "a set the transcript has room for only part of keeps none of it, so a refused call costs the budget nothing",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const db = yield* Database;
        // Note that the row leaves room for the first picture below and not the second, so the
        // refusal falls between them.
        yield* db.insert(attachment).values({
          userId: target.userId,
          conversationId: target.conversationId,
          sha256: "e".repeat(64),
          contentType: INBOX_IMAGE_TYPE.PNG,
          width: 1,
          height: 1,
          byteCount: CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION - 40,
          bytes: new Uint8Array([0]),
          createdAt: new Date(),
        });
        const binding = {
          target,
          sandbox: sandboxWith({
            [`${CHECKOUT}/first.png`]: png(10, 10, 1),
            [`${CHECKOUT}/second.png`]: png(10, 10, 2),
          }),
          checkout: CHECKOUT,
        };

        const answer = yield* show(binding, {
          images: [
            { path: "first.png", caption: "Fits alone" },
            { path: "second.png", caption: "Does not" },
          ],
        });

        assert.deepEqual(answer, refused(SHOW_IMAGE_REFUSAL.FULL));
        const kept = yield* db
          .select({ sha256: attachment.sha256 })
          .from(attachment)
          .where(eq(attachment.conversationId, target.conversationId));
        assert.deepEqual(kept, [{ sha256: "e".repeat(64) }], "the first picture was not kept");
      }),
  );
});
