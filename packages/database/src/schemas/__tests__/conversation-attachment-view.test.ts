import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { INBOX_IMAGE_TYPE } from "@luke/features/inbox-wire";
import { and, eq, sum } from "drizzle-orm";
import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import {
  keepConversationPicture,
  readConversationPicture,
} from "../../models/conversation-pictures.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB, migrationStatements } from "../../testing/index.js";
import { bytea, timestamptz } from "../_helpers.js";
import { attachment } from "../attachment.js";
import { user } from "../auth.js";
import { conversations } from "../storage.js";

/**
 * The migration that moved the pictures a conversation's tools answered
 * into `attachment` and left `conversation_attachment` as a view over it: a
 * database from before it keeps every picture under its id and hash, which
 * this code serves and finds again by its bytes, and every query a
 * deployment from before it runs against `conversation_attachment`, spelled
 * as that deployment's code spelled it, its insert standing down on the
 * conversation's hash included, reads and writes the pictures in
 * `attachment` that this code reads. Synthetic accounts and bytes throughout.
 */

const MIGRATION = "20261019212602_conversation_attachment_into_attachment";

/** `conversation_attachment` as the code before the migration declared it. */
const conversationAttachment = pgTable("conversation_attachment", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  sha256: text("sha256").notNull(),
  contentType: text("content_type").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  byteCount: integer("byte_count").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});

/** The table as it stood before the migration. */
const OLD_TABLE = `CREATE TABLE "conversation_attachment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "sha256" text NOT NULL,
  "content_type" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "byte_count" integer NOT NULL,
  "bytes" bytea NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);
CREATE UNIQUE INDEX "conversation_attachment_conversation_sha256" ON "conversation_attachment" ("conversation_id", "sha256")`;

const SHOT = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 7]);

/** A coding agent's conversation and its account. */
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

type Conversation = Effect.Success<typeof openConversation>;

/** A picture of the conversation's as the code before the migration wrote it. */
const oldPicture = (conversation: Conversation, sha256: string, bytes = SHOT) => ({
  userId: conversation.userId,
  conversationId: conversation.conversationId,
  sha256,
  contentType: INBOX_IMAGE_TYPE.PNG,
  width: 1200,
  height: 720,
  byteCount: bytes.byteLength,
  bytes,
  createdAt: new Date(0),
});

/** What `attachment` keeps for the conversation: each picture's id, hash, and size. */
const keptFor = (conversationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({
        id: attachment.id,
        sha256: attachment.sha256,
        width: attachment.width,
        height: attachment.height,
      })
      .from(attachment)
      .where(eq(attachment.conversationId, conversationId));
    return rows.toSorted((a, b) => a.id.localeCompare(b.id));
  });

it.layer(getTestDB())("conversation_attachment as a view over attachment", (it) => {
  it.effect(
    "a database from before the migration keeps every picture under its id and hash, which this code serves and finds again by its bytes, and running it again changes nothing",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const sql = yield* SqlClient.SqlClient;
        const conversation = yield* openConversation;
        const id = randomUUID();
        const sha256 = "a".repeat(64);

        // The database as it stood before the migration: conversation_attachment a table, holding a picture.
        yield* sql.unsafe(`DROP VIEW "conversation_attachment"`);
        yield* sql.unsafe(`DROP TABLE "conversation_attachment_moved"`);
        for (const statement of OLD_TABLE.split(";")) yield* sql.unsafe(statement);
        yield* db
          .insert(conversationAttachment)
          .values({ ...oldPicture(conversation, sha256), id });

        const migration = yield* migrationStatements(MIGRATION);
        for (const statement of migration) yield* sql.unsafe(statement);
        for (const statement of migration) yield* sql.unsafe(statement);

        const [kind] = yield* sql<{ readonly relkind: string }>`
          SELECT relkind FROM pg_class WHERE oid = to_regclass('public.conversation_attachment')
        `;
        assert.equal(kind?.relkind, "v");
        assert.deepEqual(yield* keptFor(conversation.conversationId), [
          { id, sha256, width: 1200, height: 720 },
        ]);
        const served = Option.getOrThrow(
          yield* readConversationPicture(conversation.conversationId, id),
        );
        assert.deepEqual([...served.bytes], [...SHOT]);
      }),
  );

  it.effect(
    "the old code's keep, its stand-down on a hash kept already, its budget's sum, and its read through conversation_attachment land in attachment, where this code reads them",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const conversation = yield* openConversation;
        const sha256 = createHash("sha256").update(SHOT).digest("hex");
        const columns = {
          id: conversationAttachment.id,
          contentType: conversationAttachment.contentType,
          width: conversationAttachment.width,
          height: conversationAttachment.height,
          byteCount: conversationAttachment.byteCount,
        };

        // The old keep, and the same bytes kept again, which stands down on the conversation's hash.
        const keep = () =>
          db
            .insert(conversationAttachment)
            .values(oldPicture(conversation, sha256))
            .onConflictDoNothing({
              target: [conversationAttachment.conversationId, conversationAttachment.sha256],
            })
            .returning(columns);
        const [first] = yield* keep();
        assert.ok(first);
        assert.deepEqual(yield* keep(), []);

        // The old lookup by hash, budget's sum, and read.
        const [found] = yield* db
          .select(columns)
          .from(conversationAttachment)
          .where(
            and(
              eq(conversationAttachment.conversationId, conversation.conversationId),
              eq(conversationAttachment.sha256, sha256),
            ),
          );
        assert.equal(found?.id, first.id);
        const [summed] = yield* db
          .select({ kept: sum(conversationAttachment.byteCount).mapWith(Number) })
          .from(conversationAttachment)
          .where(eq(conversationAttachment.conversationId, conversation.conversationId));
        assert.equal(summed?.kept, SHOT.byteLength);
        const [read] = yield* db
          .select({ bytes: conversationAttachment.bytes })
          .from(conversationAttachment)
          .where(
            and(
              eq(conversationAttachment.conversationId, conversation.conversationId),
              eq(conversationAttachment.id, first.id),
            ),
          );
        assert.deepEqual([...(read?.bytes ?? [])], [...SHOT]);

        // This code finds the old keep by its bytes, and serves it.
        assert.deepEqual(yield* keptFor(conversation.conversationId), [
          { id: first.id, sha256, width: 1200, height: 720 },
        ]);
        const again = Option.getOrThrow(
          yield* keepConversationPicture(conversation, {
            bytes: SHOT,
            contentType: INBOX_IMAGE_TYPE.PNG,
            width: 1200,
            height: 720,
          }),
        );
        assert.equal(again.id, first.id);
      }),
  );
});
