import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq, getTableColumns } from "drizzle-orm";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import { createCodingAgent } from "../../models/coding-agent-store.js";
import { createTask } from "../../models/task-store.js";
import { getTestDB, migrationStatements, openWorkspace } from "../../testing/index.js";
import { user } from "../auth.js";
import { inboxItem } from "../inbox.js";
import { inboxMessage } from "../inbox-message.js";

/**
 * The migration that lets an inbox item's thread carry asks and answers:
 * an agent's message keeps the ask it ends with and where it stands, a
 * member's keeps the answer it carries, and the item names the message
 * whose ask is open, until that message goes. A database from before it
 * keeps every item and message as they stood, asking and answering
 * nothing, and a deployment from before it still writes both as it did.
 * Synthetic accounts and rows throughout.
 */

const MIGRATION = "20261019231740_inbox_message_ask";

/** The migration undone, so the database stands as one from before it. */
const UNDO = [
  `ALTER TABLE "inbox_item" DROP CONSTRAINT "inbox_item_open_ask_message_id_inbox_message_id_fkey"`,
  `ALTER TABLE "inbox_item" DROP COLUMN "open_ask_message_id"`,
  `ALTER TABLE "inbox_message" DROP COLUMN "ask"`,
  `ALTER TABLE "inbox_message" DROP COLUMN "answers"`,
];

/** An account with a task and a coding agent on it, the place an item is posted in. */
const openAgent = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Dean", email: `${userId}@luke.test` });
  const organizationId = yield* openWorkspace(userId);
  const task = yield* createTask(userId, { organizationId, name: "Teammate invitations" });
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
  return { userId, taskId: task.id, organizationId, agentId: started.agent.id };
});

/** The item and its thread as this code reads them, the thread in the order it was written. */
const readBack = (itemId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [item] = yield* db.select().from(inboxItem).where(eq(inboxItem.id, itemId));
    const messages = yield* db
      .select()
      .from(inboxMessage)
      .where(eq(inboxMessage.itemId, itemId))
      .orderBy(inboxMessage.createdAt);
    return { item, messages };
  });

const { openAskMessageId: _openAsk, ...itemColumnsBefore } = getTableColumns(inboxItem);
const { ask: _ask, answers: _answers, ...messageColumnsBefore } = getTableColumns(inboxMessage);

/** The item and its thread as they read before the migration, by the columns that stood then. */
const readBefore = (itemId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [item] = yield* db
      .select(itemColumnsBefore)
      .from(inboxItem)
      .where(eq(inboxItem.id, itemId));
    const messages = yield* db
      .select(messageColumnsBefore)
      .from(inboxMessage)
      .where(eq(inboxMessage.itemId, itemId))
      .orderBy(inboxMessage.createdAt);
    return { item, messages };
  });

// Each case stands on a database of its own, since the first walks the migration back.
it.layer(getTestDB())("inbox_message_ask over a database from before it", (it) => {
  it.effect(
    "an item and its message from before the migration read back as they stood, asking and answering nothing, a deployment from before it still writes both, and running it again changes nothing",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const place = yield* openAgent;
        for (const statement of UNDO) yield* sql.unsafe(statement);

        // Written as a deployment from before the migration writes them, naming none of its columns.
        // Note that the view columns a later migration dropped are left out, since only this migration is undone.
        const itemId = randomUUID();
        const memberMessageId = randomUUID();
        yield* sql`insert into inbox_item (id, user_id, task_id, organization_id, agent_id, key, revision, version, title, needs_reply, status, posted_at, updated_at)
          values (${itemId}, ${place.userId}, ${place.taskId}, ${place.organizationId}, ${place.agentId}, 'branch-protection', 1, 4, 'Require a review on main', true, 'open', '2026-10-17T09:00:00Z', '2026-10-17T09:00:00Z')`;
        yield* sql`insert into inbox_message (id, item_id, author, user_id, text, client_key, created_at)
          values (${memberMessageId}, ${itemId}, 'member', ${place.userId}, 'Which branches?', 'key-1', '2026-10-17T09:05:00Z')`;
        const before = yield* readBefore(itemId);

        const migration = yield* migrationStatements(MIGRATION);
        for (const statement of migration) yield* sql.unsafe(statement);
        for (const statement of migration) yield* sql.unsafe(statement);

        const agentMessageId = randomUUID();
        yield* sql`insert into inbox_message (id, item_id, author, user_id, text, client_key, created_at)
          values (${agentMessageId}, ${itemId}, 'agent', null, 'Main alone.', null, '2026-10-17T09:06:00Z')`;
        yield* sql`update inbox_item set revision = 2, updated_at = '2026-10-17T09:06:00Z' where id = ${itemId}`;

        const after = yield* readBack(itemId);
        assert.deepEqual(after.item, {
          ...before.item,
          revision: 2,
          updatedAt: new Date("2026-10-17T09:06:00Z"),
          openAskMessageId: null,
        });
        assert.deepEqual(
          after.messages.map(({ id, text, ask, answers }) => ({ id, text, ask, answers })),
          [
            { id: memberMessageId, text: "Which branches?", ask: null, answers: null },
            { id: agentMessageId, text: "Main alone.", ask: null, answers: null },
          ],
        );
        assert.deepEqual(after.messages[0], { ...before.messages[0], ask: null, answers: null });
      }),
  );
});
