import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { attachment } from "@luke/database/schemas/attachment";
import { organization, user } from "@luke/database/schemas/auth";
import { inboxMessage } from "@luke/database/schemas/inbox-message";
import { INBOX_ATTACHMENT_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB, migrationStatements, startTask } from "@luke/database/testing";
import { CODING_AGENT_ATTACHMENT_TYPE } from "@luke/features/coding-agent-wire";
import { INBOX_MESSAGE_AUTHOR, INBOX_RESPONSE } from "@luke/features/inbox-wire";
import { and, eq, ne, notInArray } from "drizzle-orm";
import { customType, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { postInboxItem, readInboxAttachment, readInboxItem } from "./inbox-store.js";

/**
 * The migration that moved an inbox item's files into `attachment` and left
 * `inbox_attachment` as a view over it: a database from before it keeps
 * every file of every kind, which this code reads, and every query a
 * deployment from before it runs against `inbox_attachment`, spelled as that
 * deployment's code spelled it, reads and writes the files in `attachment`
 * that this code reads. Synthetic accounts, tasks, and files throughout.
 */

const MIGRATION = "20261019195803_inbox_attachment_into_attachment";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/** `inbox_attachment` as the code before the migration declared it. */
const inboxAttachment = pgTable("inbox_attachment", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  taskId: uuid("task_id"),
  organizationId: text("organization_id").notNull(),
  itemId: uuid("item_id").notNull(),
  messageId: uuid("message_id"),
  kind: text("kind").notNull().default(INBOX_ATTACHMENT_KIND.IMAGE),
  name: text("name"),
  position: integer("position"),
  contentType: text("content_type").notNull(),
  byteCount: integer("byte_count").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** The table as it stood before the migration, its constraints but its check among it. */
const OLD_TABLE = `CREATE TABLE "inbox_attachment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "task_id" uuid REFERENCES "task"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "inbox_item"("id") ON DELETE CASCADE,
  "message_id" uuid REFERENCES "inbox_message"("id") ON DELETE CASCADE,
  "kind" text DEFAULT 'image' NOT NULL,
  "name" text,
  "position" integer,
  "content_type" text NOT NULL,
  "byte_count" integer NOT NULL,
  "bytes" bytea NOT NULL,
  "created_at" timestamp with time zone NOT NULL
)`;

const SHOT = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const TRACE = new TextEncoder().encode("TypeError: invite is undefined\n");

/** An agent's posted inbox item, a message on its thread, and the account, task, and workspace they stand in. */
const openItem = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = Option.getOrThrow(
    yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      planSnapshot: "# Teammate invitations\n",
      prompt: null,
    }),
  );
  const posted = yield* postInboxItem(
    { userId, taskId: task.id, agentId: started.agent.id },
    {
      key: "invite-copy",
      title: "Check the invite copy",
      response: { type: INBOX_RESPONSE.NONE },
      needsReply: false,
    },
  );
  assert.ok(Result.isSuccess(posted));
  const now = yield* DateTime.nowAsDate;
  const [message] = yield* db
    .insert(inboxMessage)
    .values({
      itemId: posted.success.id,
      author: INBOX_MESSAGE_AUTHOR.MEMBER,
      userId,
      text: "Here is the trace.",
      createdAt: now,
    })
    .returning({ id: inboxMessage.id });
  assert.ok(message);
  return {
    userId,
    taskId: task.id,
    organizationId: task.workspaceId,
    itemId: posted.success.id,
    messageId: message.id,
    now,
  };
});

type Item = Effect.Success<typeof openItem>;

/** The three kinds of file an item keeps, as the code before the migration wrote each. */
const oldRows = (item: Item) => {
  const scope = {
    userId: item.userId,
    taskId: item.taskId,
    organizationId: item.organizationId,
    itemId: item.itemId,
    createdAt: item.now,
  };
  return {
    image: {
      ...scope,
      id: randomUUID(),
      contentType: CODING_AGENT_ATTACHMENT_TYPE.PNG,
      byteCount: SHOT.byteLength,
      bytes: SHOT,
    },
    answer: {
      ...scope,
      id: randomUUID(),
      kind: INBOX_ATTACHMENT_KIND.ANSWER,
      name: "trace.txt",
      position: 0,
      contentType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
      byteCount: TRACE.byteLength,
      bytes: TRACE,
    },
    message: {
      ...scope,
      id: randomUUID(),
      messageId: item.messageId,
      kind: INBOX_ATTACHMENT_KIND.MESSAGE,
      name: "after.png",
      position: 0,
      contentType: CODING_AGENT_ATTACHMENT_TYPE.PNG,
      byteCount: SHOT.byteLength,
      bytes: SHOT,
    },
  };
};

/** What `attachment` keeps for the item, by id: its kind, its message, and its bytes. */
const keptFor = (itemId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({
        id: attachment.id,
        organizationId: attachment.organizationId,
        kind: attachment.kind,
        inboxMessageId: attachment.inboxMessageId,
        bytes: attachment.bytes,
      })
      .from(attachment)
      .where(eq(attachment.inboxItemId, itemId));
    return rows
      .map((row) => ({ ...row, bytes: [...row.bytes] }))
      .toSorted((a, b) => a.id.localeCompare(b.id));
  });

/** Each file's bytes as this code serves them to the item's account. */
const served = (item: Item, ids: readonly string[]) =>
  Effect.forEach(ids, (id) =>
    Effect.map(readInboxAttachment(item.userId, item.itemId, id), (found) =>
      Option.map(found, (file) => [...new Uint8Array(file.bytes)]),
    ),
  );

it.layer(getTestDB())("inbox_attachment as a view over attachment", (it) => {
  it.effect(
    "a database from before the migration keeps every file of every kind under its id, which this code serves and lists, and running it again changes nothing",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const sql = yield* SqlClient.SqlClient;
        const item = yield* openItem;
        const rows = oldRows(item);

        // The database as it stood before the migration: inbox_attachment a table holding one file of each kind, and attachment without its inbox columns.
        yield* sql.unsafe(`DROP VIEW "inbox_attachment"`);
        yield* sql.unsafe(OLD_TABLE);
        yield* db.insert(inboxAttachment).values([rows.image, rows.answer, rows.message]);
        yield* sql.unsafe(`ALTER TABLE "attachment" DROP CONSTRAINT "attachment_inbox_kind"`);
        yield* sql.unsafe(
          `ALTER TABLE "attachment" DROP CONSTRAINT "attachment_one_owner", ADD CONSTRAINT "attachment_one_owner" CHECK (num_nonnulls("chat_message_id") = 1)`,
        );
        for (const column of [
          "user_id",
          "task_id",
          "inbox_item_id",
          "inbox_message_id",
          "kind",
          "name",
          "position",
        ]) {
          yield* sql.unsafe(`ALTER TABLE "attachment" DROP COLUMN "${column}"`);
        }

        const migration = yield* migrationStatements(MIGRATION);
        for (const statement of migration) yield* sql.unsafe(statement);
        for (const statement of migration) yield* sql.unsafe(statement);

        const [kind] = yield* sql<{ readonly relkind: string }>`
          SELECT relkind FROM pg_class WHERE oid = to_regclass('public.inbox_attachment')
        `;
        assert.equal(kind?.relkind, "v");
        assert.deepEqual(
          yield* keptFor(item.itemId),
          (
            [
              [rows.image, INBOX_ATTACHMENT_KIND.IMAGE, null],
              [rows.answer, INBOX_ATTACHMENT_KIND.ANSWER, null],
              [rows.message, INBOX_ATTACHMENT_KIND.MESSAGE, item.messageId],
            ] as const
          )
            .map(([row, kind, messageId]) => ({
              id: row.id,
              organizationId: item.organizationId,
              kind,
              inboxMessageId: messageId,
              bytes: [...row.bytes],
            }))
            .toSorted((a, b) => a.id.localeCompare(b.id)),
        );
        assert.deepEqual(yield* served(item, [rows.image.id, rows.answer.id, rows.message.id]), [
          Option.some([...SHOT]),
          Option.some([...TRACE]),
          Option.some([...SHOT]),
        ]);
      }),
  );

  it.effect(
    "the old code's writes, reads, deletes, and moves through inbox_attachment land in attachment, where this code reads them",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const item = yield* openItem;
        const rows = oldRows(item);

        // Each kind as the old store wrote it: the picture leaving its kind to the column's default.
        yield* db.insert(inboxAttachment).values(rows.image);
        yield* db
          .insert(inboxAttachment)
          .values({ ...rows.answer, kind: INBOX_ATTACHMENT_KIND.ANSWER });
        yield* db
          .insert(inboxAttachment)
          .values({ ...rows.message, kind: INBOX_ATTACHMENT_KIND.MESSAGE });
        assert.deepEqual(
          (yield* keptFor(item.itemId)).map((row) => [row.id, row.kind]),
          [
            [rows.image.id, INBOX_ATTACHMENT_KIND.IMAGE],
            [rows.answer.id, INBOX_ATTACHMENT_KIND.ANSWER],
            [rows.message.id, INBOX_ATTACHMENT_KIND.MESSAGE],
          ].toSorted(([a], [b]) => String(a).localeCompare(String(b))),
        );
        assert.deepEqual(
          Option.getOrThrow(yield* readInboxItem(item.userId, item.itemId)).item.answerFiles?.map(
            (file) => [file.attachmentId, file.name],
          ),
          [[rows.answer.id, "trace.txt"]],
        );

        // The old read: the item's file by its id, joined to its item.
        const [read] = yield* db
          .select({ bytes: inboxAttachment.bytes })
          .from(inboxAttachment)
          .where(
            and(eq(inboxAttachment.itemId, item.itemId), eq(inboxAttachment.id, rows.answer.id)),
          );
        assert.deepEqual([...(read?.bytes ?? [])], [...TRACE]);

        // The old post again: every file no block names, but the thread's, deleted.
        yield* db
          .delete(inboxAttachment)
          .where(
            and(
              eq(inboxAttachment.itemId, item.itemId),
              ne(inboxAttachment.kind, INBOX_ATTACHMENT_KIND.MESSAGE),
              notInArray(inboxAttachment.id, [rows.image.id]),
            ),
          );
        assert.deepEqual(
          (yield* keptFor(item.itemId)).map((row) => row.id),
          [rows.image.id, rows.message.id].toSorted(),
        );

        // The old move of the task's inbox to another workspace.
        const elsewhere = randomUUID();
        yield* db.insert(organization).values({
          id: elsewhere,
          name: "Elsewhere",
          slug: `elsewhere-${elsewhere}`,
          createdAt: item.now,
        });
        yield* db
          .update(inboxAttachment)
          .set({ organizationId: elsewhere })
          .where(eq(inboxAttachment.taskId, item.taskId));
        assert.deepEqual(
          (yield* keptFor(item.itemId)).map((row) => row.organizationId),
          [elsewhere, elsewhere],
        );
        assert.deepEqual(yield* served(item, [rows.image.id, rows.answer.id]), [
          Option.some([...SHOT]),
          Option.none(),
        ]);
      }),
  );
});
