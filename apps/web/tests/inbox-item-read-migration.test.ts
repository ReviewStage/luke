import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@repo/database/core/migrator";
import { joinWorkspace, openWorkspace, unmigratedPgliteSqlClient } from "@repo/database/testing";
import { INBOX_ASK } from "@repo/features/inbox-wire";
import { postInboxThread, readInboxItem } from "@repo/service/inbox/inbox-store";
import { Effect, Layer, Option, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

const MIGRATION = "20261018153718_inbox_item_read";

const foldersBefore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "before-inbox-read-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(MIGRATION) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

const openUser = (id: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`insert into "user" (id, name, email) values (${id}, ${id}, ${`${id}@app.test`})`,
  );

it.effect(
  "an item that stood before unread was kept reads as read for every member, and one posted after it as unread",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore);
        yield* openUser("dean");
        yield* openUser("charles");
        const task = { id: randomUUID(), workspaceId: yield* openWorkspace("dean") };
        yield* sql`insert into task (id, user_id, organization_id, name, document) values (${task.id}, 'dean', ${task.workspaceId}, 'Teammate invitations', '')`;
        yield* joinWorkspace(task.workspaceId, "charles");
        const agent = { id: randomUUID(), conversationId: randomUUID() };
        yield* sql`insert into conversations (id, user_id, kind) values (${agent.conversationId}, 'dean', 'coding_agent')`;
        yield* sql`insert into coding_agent (id, task_id, organization_id, user_id, conversation_id, model, effort, plan_snapshot, repository, idempotency_key)
          values (${agent.id}, ${task.id}, ${task.workspaceId}, 'dean', ${agent.conversationId}, 'anthropic/claude-opus-5.5', 'high', '# Teammate invitations', 'acme/relay', ${randomUUID()})`;
        const standing = randomUUID();
        yield* sql`insert into inbox_item (id, user_id, task_id, organization_id, agent_id, key, revision, version, title, blocks, response, needs_reply, status, posted_at, updated_at)
          values (${standing}, 'dean', ${task.id}, ${task.workspaceId}, ${agent.id}, 'branch-protection', 1, 4, 'Require a review on main', '[]'::jsonb, '{"type":"task"}'::jsonb, false, 'open', '2026-10-17T09:00:00Z', '2026-10-17T09:00:00Z')`;

        yield* runWebMigrations();
        yield* sql`delete from __drizzle_migrations where name = ${MIGRATION}`;
        yield* runWebMigrations();

        const posted = yield* postInboxThread(
          { userId: "dean", taskId: task.id, agentId: agent.id },
          {
            key: "invite-copy",
            title: "What should it say?",
            body: "The invitation email needs its words.",
            ask: { type: INBOX_ASK.ANSWER },
          },
        );
        assert.ok(Result.isSuccess(posted));
        const unread = (reader: string, itemId: string) =>
          Effect.map(
            readInboxItem(reader, itemId),
            (found) => Option.getOrThrow(found).item.unread,
          );
        assert.deepEqual(
          [yield* unread("dean", standing), yield* unread("charles", standing)],
          [false, false],
        );
        assert.deepEqual(
          [yield* unread("dean", posted.success.id), yield* unread("charles", posted.success.id)],
          [true, true],
        );
        const markers = yield* sql<{
          readonly count: number;
        }>`select count(*)::int as count from inbox_item_read`;
        assert.deepEqual(markers, [{ count: 0 }], "no marker was written for the items standing");
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
