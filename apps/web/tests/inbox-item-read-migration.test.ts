import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@luke/database/core/migrator";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { user } from "@luke/database/schemas/auth";
import { joinWorkspace, startTask, unmigratedPgliteSqlClient } from "@luke/database/testing";
import { INBOX_RESPONSE } from "@luke/features/inbox-wire";
import { postInboxItem, readInboxItem } from "@luke/service/inbox/inbox-store";
import { Effect, Layer, Option, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * inbox-item-read-migration.test.ts -- the migration that keeps a member's read state on an inbox item, over items that stood before it.
 *
 * Over a database migrated up to it, holding an item an agent posted: once
 * it runs, that item reads as read for its starter and a teammate alike,
 * with no marker of theirs written, while an item posted after it reads
 * unread for both; and a second run changes nothing. Synthetic accounts
 * throughout.
 */

const MIGRATION = "20261018153718_inbox_item_read";

/** A migrations folder holding every migration named before this one, and none after. */
const foldersBefore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-before-inbox-read-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(MIGRATION) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

const openUser = (id: string) =>
  Database.use((db) => db.insert(user).values({ id, name: id, email: `${id}@luke.test` }));

it.effect(
  "an item that stood before unread was kept reads as read for every member, and one posted after it as unread",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore);
        yield* openUser("dean");
        yield* openUser("charles");
        const task = yield* startTask("dean", { name: "Teammate invitations" });
        yield* joinWorkspace(task.workspaceId, "charles");
        const started = Option.getOrThrow(
          yield* createCodingAgent("dean", {
            taskId: task.id,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/relay",
            planSnapshot: "# Teammate invitations\n",
            prompt: null,
          }),
        );
        const standing = randomUUID();
        yield* sql`insert into inbox_item (id, user_id, task_id, organization_id, agent_id, key, revision, version, title, blocks, response, needs_reply, status, posted_at, updated_at)
          values (${standing}, 'dean', ${task.id}, ${task.workspaceId}, ${started.agent.id}, 'branch-protection', 1, 4, 'Require a review on main', '[]'::jsonb, '{"type":"task"}'::jsonb, false, 'open', '2026-10-17T09:00:00Z', '2026-10-17T09:00:00Z')`;

        yield* runWebMigrations();
        yield* sql`delete from __drizzle_migrations where name = ${MIGRATION}`;
        yield* runWebMigrations();

        const posted = yield* postInboxItem(
          { userId: "dean", taskId: task.id, agentId: started.agent.id },
          {
            key: "invite-copy",
            title: "What should it say?",
            response: { type: INBOX_RESPONSE.TEXT },
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
