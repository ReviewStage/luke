import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { BRAIN_RUN_EVENT, BRAIN_TURN_ORIGIN, BRAIN_TURN_TRIGGER } from "@luke/features/brain";
import { CODING_AGENT_ATTACHMENT_TYPE } from "@luke/features/coding-agent-wire";
import { lineFileIdOf } from "@luke/features/line-file-wire";
import { sessionKey } from "@luke/runtime/vocabulary";
import { MESSAGE_ROLE, TURN_ORIGIN } from "@luke/wire";
import type { StoredUIMessage } from "@luke/wire/ui-messages";
import { isFileUIPart } from "ai";
import { eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { Database } from "../../core/query.js";
import { attachment } from "../../schemas/attachment.js";
import { user } from "../../schemas/auth.js";
import { conversations, messages } from "../../schemas/storage.js";
import { CONVERSATION_KIND, MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import { readConversationPicture } from "../conversation-pictures.js";
import { sentLineId } from "../ids.js";
import { countInlineLineFiles, LINE_FILE_BACKFILL, moveInlineLineFiles } from "../line-files.js";
import { type ConversationTarget, storeWriter } from "../writer.js";

/**
 * The files a developer's line carried, over a real dialect: a new line
 * keeps each beside its conversation and names it in the row, eve's receipt
 * of a line whose text file was kept still takes the line, and the backfill
 * moves every row written inline before, batch by batch, leaving nothing
 * inline and moving nothing the second time.
 *
 * Synthetic accounts and bytes throughout: no file is a real one.
 */

/** A picture's signature and a mark, which is all the store reads of it. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const shot = (mark: number) => ({
  name: `shot-${String(mark)}.png`,
  mediaType: CODING_AGENT_ATTACHMENT_TYPE.PNG,
  data: Buffer.from([...PNG, mark]).toString("base64"),
});

const notes = {
  name: "notes.txt",
  mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
  data: Buffer.from("ship the copy fix\n").toString("base64"),
};

type File = typeof notes | ReturnType<typeof shot>;

const inline = (file: File) => `data:${file.mediaType};base64,${file.data}`;

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

/** The parts of the row under the client id given, as the store holds them. */
const partsOf = (clientId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .select({ parts: messages.parts })
      .from(messages)
      .where(eq(messages.clientId, clientId));
    return row?.parts ?? assert.fail("no such row");
  });

/** The URLs of the file parts given. */
const fileUrls = (parts: StoredUIMessage["parts"]) =>
  parts.filter(isFileUIPart).map((part) => part.url);

/** The file a kept URL names, read back through its conversation, as the `data:` URL it was sent as. */
const drawn = (conversationId: string, url: string) =>
  Effect.map(readConversationPicture(conversationId, lineFileIdOf(url) ?? ""), (read) => {
    const kept = Option.getOrThrow(read);
    return `data:${kept.contentType};base64,${Buffer.from(kept.bytes).toString("base64")}`;
  });

/** A row written as the store wrote a line before the move: its words, then each file inline. */
const inlineRow = (target: ConversationTarget, seq: number, files: readonly File[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const clientId = randomUUID();
    yield* db.insert(messages).values({
      userId: target.userId,
      conversationId: target.conversationId,
      seq,
      clientId,
      role: MESSAGE_ROLE.USER,
      parts: [
        { type: "text", text: `line ${String(seq)}`, state: "done" },
        ...files.map((file) => ({
          type: "file" as const,
          mediaType: file.mediaType,
          filename: file.name,
          url: inline(file),
        })),
      ],
      placedAt: new Date(),
    });
    return clientId;
  });

const keptRows = (conversationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db
      .select({ id: attachment.id })
      .from(attachment)
      .where(eq(attachment.conversationId, conversationId));
  });

/** Every batch the backfill runs, until one reads fewer rows than a batch holds. */
const backfill = Effect.gen(function* () {
  let after: string | undefined;
  let moved = 0;
  for (;;) {
    const batch = yield* moveInlineLineFiles(after);
    moved += batch.moved;
    after = batch.last;
    if (batch.read < LINE_FILE_BACKFILL.BATCH_ROWS) return moved;
  }
});

it.layer(getTestDB())("the files a line carried", (it) => {
  it.effect(
    "a new line keeps each file beside its conversation once and names it in the row, and eve's receipt of it still takes it",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const writer = yield* storeWriter({ tools: {} });
        const clientKey = randomUUID();
        yield* writer.writeAwaitingLine(
          target,
          {
            text: "Look at these.",
            clientKey,
            attachments: [shot(1), notes, shot(1)],
            sender: { kind: MESSAGE_SENDER.LUKE },
          },
          Effect.succeed(true),
        );

        const urls = fileUrls(yield* partsOf(sentLineId(clientKey)));
        assert.equal(urls.length, 3);
        assert.ok(
          urls.every((url) => lineFileIdOf(url) !== undefined),
          "every part names a row",
        );
        assert.equal(urls[0], urls[2], "the same bytes are one row");
        assert.equal((yield* keptRows(target.conversationId)).length, 2);
        assert.deepEqual(yield* Effect.forEach(urls, (url) => drawn(target.conversationId, url)), [
          inline(shot(1)),
          inline(notes),
          inline(shot(1)),
        ]);

        const turnId = randomUUID();
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_0",
        });
        yield* writer.consume(target, {
          conversationId: sessionKey(target.conversationId),
          turnId,
          kind: BRAIN_RUN_EVENT.TURN_STARTED,
          sequence: 1,
          origin: BRAIN_TURN_ORIGIN.TYPED,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          at: 0,
        });
        // eve's receipt: the words, the text file inlined under its heading, then each picture by its mark.
        const received = [
          "Look at these.",
          "Attached file: notes.txt\n```\nship the copy fix\n\n```",
          "[file: shot-1.png (image/png)]",
          "[file: shot-1.png (image/png)]",
        ].join("\n\n");
        const taken = yield* writer.takeAwaitingLine(target, { text: received, turnId });
        assert.deepEqual(
          Result.map(taken, (ids) => ids.length),
          Result.succeed(1),
        );
      }),
  );

  it.effect(
    "the backfill moves every inline file beside its conversation, leaves no file inline, draws the same files, and moves nothing run again",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const other = yield* openConversation;
        const rows = LINE_FILE_BACKFILL.BATCH_ROWS + 3;
        const written = yield* Effect.forEach(
          Array.from({ length: rows }, (_, at) => at),
          (at) => inlineRow(at % 2 === 0 ? target : other, at + 1, [shot(at % 3), notes]),
        );
        const before = yield* countInlineLineFiles();
        assert.ok(before.rows >= rows);

        assert.ok((yield* backfill) >= rows);

        assert.deepEqual(yield* countInlineLineFiles(), { rows: 0, parts: 0 });
        for (const [at, clientId] of written.entries()) {
          const owner = at % 2 === 0 ? target : other;
          const urls = fileUrls(yield* partsOf(clientId));
          assert.deepEqual(yield* Effect.forEach(urls, (url) => drawn(owner.conversationId, url)), [
            inline(shot(at % 3)),
            inline(notes),
          ]);
        }
        assert.equal(
          (yield* keptRows(target.conversationId)).length,
          4,
          "three shots and the notes",
        );
        const kept = (yield* keptRows(target.conversationId)).length;

        assert.equal(yield* backfill, 0);
        assert.equal((yield* keptRows(target.conversationId)).length, kept);
      }),
  );
});
