import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CHAT_BLOCK, CHAT_IMAGE_TYPE, MEMBER_KIND } from "@luke/features/chat-wire";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Result } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database, queryBuilder } from "../../core/query.js";
import {
  ensureMember,
  ensureTaskChannel,
  postMessage,
  readAttachment,
} from "../../models/chat-store.js";
import { createTask } from "../../models/task-store.js";
import { getTestDB, migrationStatements } from "../../testing/index.js";
import { bytea, timestamptz } from "../_helpers.js";
import { attachment } from "../attachment.js";
import { member, organization, user } from "../auth.js";
import { chatMessage } from "../chat.js";

/**
 * The migration that moved chat's pictures into `attachment` and left
 * `chat_attachment` as a view over it: a database from before it keeps
 * every picture, and every query a deployment from before it runs against
 * `chat_attachment`, spelled as that deployment's code spelled it, reads and
 * writes the pictures in `attachment` that the code of this one reads.
 * Synthetic accounts and rows throughout.
 */

const MIGRATION = "20261019183202_chat_attachment_into_attachment";

/** The migration that made `chat_attachment` a table, whose statements stand the table up again. */
const TABLE_MIGRATION = "20261016223634_chat_attachments";

/** `chat_attachment` as the code before the migration declared it. */
const chatAttachment = pgTable("chat_attachment", {
  id: uuid("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  messageId: uuid("message_id").notNull(),
  contentType: text("content_type").notNull(),
  byteCount: integer("byte_count").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});

/** A chat message in a task's channel whose image blocks name the ids given, its workspace, and its account. */
const openMessage = (pictureIds: readonly string[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const organizationId = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db
      .insert(organization)
      .values({ id: organizationId, name: "Acme", slug: `acme-${organizationId}`, createdAt: now });
    yield* db
      .insert(member)
      .values({ id: randomUUID(), organizationId, userId, role: "owner", createdAt: now });
    const task = yield* createTask(userId, { organizationId, name: "Invite flow" });
    const author = Option.getOrThrow(
      yield* ensureMember(userId, organizationId, { kind: MEMBER_KIND.HUMAN, userId }),
    );
    const channel = Option.getOrThrow(yield* ensureTaskChannel(userId, task.id));
    const posted = Result.getOrThrow(
      yield* postMessage(userId, organizationId, {
        authorMemberId: author.id,
        to: { channelId: channel.id },
        blocks: pictureIds.map((attachmentId) => ({
          type: CHAT_BLOCK.IMAGE,
          attachmentId,
          alt: "The rendered invite.",
        })),
        mentions: [],
        clientKey: randomUUID(),
      }),
    );
    return { userId, organizationId, messageId: posted.message.id, channelId: channel.id };
  });

/** The pictures `attachment` keeps for the message, by id. */
const keptFor = (messageId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({
        id: attachment.id,
        organizationId: attachment.organizationId,
        bytes: attachment.bytes,
      })
      .from(attachment)
      .where(eq(attachment.chatMessageId, messageId));
    return rows
      .map((row) => ({ ...row, bytes: [...row.bytes] }))
      .toSorted((a, b) => a.id.localeCompare(b.id));
  });

it.layer(getTestDB())("chat_attachment as a view over attachment", (it) => {
  it.effect(
    "a database from before the migration ends with attachment holding exactly chat_attachment's pictures, under their ids and workspaces, readable through both names, and running it again changes nothing",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const sql = yield* SqlClient.SqlClient;
        const uncopied = { id: randomUUID(), bytes: new Uint8Array([137, 80, 78, 71, 1]) };
        const moved = { id: randomUUID(), bytes: new Uint8Array([137, 80, 78, 71, 2]) };
        const dropped = { id: randomUUID(), bytes: new Uint8Array([137, 80, 78, 71, 3]) };
        const { userId, organizationId, messageId } = yield* openMessage([
          uncopied.id,
          moved.id,
          dropped.id,
        ]);
        const now = yield* DateTime.nowAsDate;
        const row = (picture: typeof uncopied, organization = organizationId) => ({
          id: picture.id,
          organizationId: organization,
          contentType: CHAT_IMAGE_TYPE.PNG,
          byteCount: picture.bytes.byteLength,
          bytes: picture.bytes,
          createdAt: now,
        });
        const earlier = randomUUID();
        yield* db
          .insert(organization)
          .values({ id: earlier, name: "Earlier", slug: `earlier-${earlier}`, createdAt: now });

        // The database as it stood before the migration: chat_attachment a table, and attachment
        // behind it by a picture never copied, one moved since its copy, and one dropped since.
        yield* sql.unsafe(`DROP VIEW "chat_attachment"`);
        for (const statement of yield* migrationStatements(TABLE_MIGRATION)) {
          yield* sql.unsafe(statement);
        }
        yield* db
          .insert(chatAttachment)
          .values([uncopied, moved].map((picture) => ({ ...row(picture), messageId })));
        yield* db.insert(attachment).values([
          { ...row(moved, earlier), chatMessageId: messageId },
          { ...row(dropped), chatMessageId: messageId },
        ]);

        const migration = yield* migrationStatements(MIGRATION);
        for (const statement of migration) yield* sql.unsafe(statement);
        for (const statement of migration) yield* sql.unsafe(statement);

        const [kind] = yield* sql<{ readonly relkind: string }>`
          SELECT relkind FROM pg_class WHERE oid = to_regclass('public.chat_attachment')
        `;
        assert.equal(kind?.relkind, "v");
        assert.deepEqual(
          yield* keptFor(messageId),
          [uncopied, moved]
            .map((picture) => ({ id: picture.id, organizationId, bytes: [...picture.bytes] }))
            .toSorted((a, b) => a.id.localeCompare(b.id)),
        );
        assert.deepEqual(
          [
            ...Option.getOrThrow(
              yield* readAttachment(userId, organizationId, messageId, uncopied.id),
            ).bytes,
          ],
          [...uncopied.bytes],
        );
      }),
  );

  it.effect(
    "the old code's writes, deletes, moves, and reads through chat_attachment land in attachment, where this code reads them",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const png = { id: randomUUID(), bytes: new Uint8Array([137, 80, 78, 71]) };
        const webp = { id: randomUUID(), bytes: new Uint8Array([82, 73, 70, 70]) };
        const { userId, organizationId, messageId, channelId } = yield* openMessage([
          png.id,
          webp.id,
        ]);
        const now = yield* DateTime.nowAsDate;
        const write = (picture: typeof png) =>
          db
            .insert(chatAttachment)
            .values({
              id: picture.id,
              organizationId,
              messageId,
              contentType: CHAT_IMAGE_TYPE.PNG,
              byteCount: picture.bytes.byteLength,
              bytes: picture.bytes,
              createdAt: now,
            })
            .onConflictDoNothing();

        // A write before the one table, and one between it and the move: the second copies its row across.
        yield* write(png);
        yield* write(webp);
        yield* write({ ...webp, bytes: new Uint8Array([0]) });
        yield* db
          .insert(attachment)
          .select(
            queryBuilder
              .select({
                id: chatAttachment.id,
                organizationId: chatAttachment.organizationId,
                chatMessageId: chatAttachment.messageId,
                contentType: chatAttachment.contentType,
                byteCount: chatAttachment.byteCount,
                bytes: chatAttachment.bytes,
                createdAt: chatAttachment.createdAt,
              })
              .from(chatAttachment)
              .where(and(eq(chatAttachment.id, webp.id), eq(chatAttachment.messageId, messageId))),
          )
          .onConflictDoNothing();
        assert.deepEqual(
          yield* keptFor(messageId),
          [png, webp]
            .map((picture) => ({ id: picture.id, organizationId, bytes: [...picture.bytes] }))
            .toSorted((a, b) => a.id.localeCompare(b.id)),
        );

        const [read] = yield* db
          .select({ bytes: chatAttachment.bytes })
          .from(chatAttachment)
          .where(
            and(
              eq(chatAttachment.organizationId, organizationId),
              eq(chatAttachment.messageId, messageId),
              eq(chatAttachment.id, png.id),
            ),
          );
        assert.deepEqual([...(read?.bytes ?? [])], [...png.bytes]);

        yield* db
          .delete(chatAttachment)
          .where(
            and(eq(chatAttachment.messageId, messageId), notInArray(chatAttachment.id, [webp.id])),
          );
        assert.deepEqual(
          (yield* keptFor(messageId)).map((row) => row.id),
          [webp.id],
        );

        const elsewhere = randomUUID();
        yield* db.insert(organization).values({
          id: elsewhere,
          name: "Elsewhere",
          slug: `elsewhere-${elsewhere}`,
          createdAt: now,
        });
        yield* db
          .update(chatAttachment)
          .set({ organizationId: elsewhere })
          .where(
            inArray(
              chatAttachment.messageId,
              queryBuilder
                .select({ id: chatMessage.id })
                .from(chatMessage)
                .where(eq(chatMessage.channelId, channelId)),
            ),
          );
        assert.deepEqual(
          (yield* keptFor(messageId)).map((row) => row.organizationId),
          [elsewhere],
        );
        assert.deepEqual(
          yield* readAttachment(userId, organizationId, messageId, webp.id),
          Option.none(),
        );
      }),
  );
});
