import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@luke/database/core/migrator";
import { Database } from "@luke/database/core/query";
import { ensureGeneralChannel } from "@luke/database/models/channel-store";
import { user } from "@luke/database/schemas/auth";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { openWorkspace, unmigratedPgliteSqlClient } from "@luke/database/testing";
import { postInboxThread } from "@luke/service/inbox/inbox-store";
import { Effect, Layer, Result } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * inbox-item-channel-migration.test.ts -- the migration that puts every inbox thread in a channel, over items that stood before it.
 *
 * Over a database migrated up to it, holding items in two workspaces: once
 * it runs, each item stands in its own workspace's #general, and a thread
 * posted after it in a workspace made since, which names no channel, lands
 * in that workspace's #general, minted for it. Synthetic accounts
 * throughout.
 */

const MIGRATION = "20261025202554_inbox_item_channel";

/** A migrations folder holding every migration named before this one, and none after. */
const foldersBefore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-before-channel-" });
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

/** A task and its agent in the account's new workspace, written as the schema of then holds them, since the store writes columns later migrations add. */
const openAgent = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const workspaceId = yield* openWorkspace(userId);
    const taskId = randomUUID();
    yield* sql`insert into task (id, user_id, organization_id, name, document, number) values (${taskId}, ${userId}, ${workspaceId}, 'Teammate invitations', '', 1)`;
    const agentId = randomUUID();
    const conversationId = randomUUID();
    yield* sql`insert into conversations (id, user_id, kind) values (${conversationId}, ${userId}, ${CONVERSATION_KIND.CODING_AGENT})`;
    yield* sql`insert into coding_agent (id, task_id, organization_id, user_id, conversation_id, model, effort, plan_snapshot, repository, idempotency_key)
      values (${agentId}, ${taskId}, ${workspaceId}, ${userId}, ${conversationId}, 'anthropic/claude-opus-5.5', 'high', '# Teammate invitations', 'acme/relay', ${randomUUID()})`;
    return { workspaceId, taskId, agentId };
  });

it.effect(
  "every item standing goes to its workspace's #general, and a thread posted after it to a #general minted for it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore);
        yield* openUser("dean");
        yield* openUser("charles");
        const deans = yield* openAgent("dean");
        const charless = yield* openAgent("charles");
        for (const [owner, place] of [
          ["dean", deans],
          ["charles", charless],
        ] as const) {
          yield* sql`insert into inbox_item (id, user_id, task_id, organization_id, agent_id, key, revision, version, title, needs_reply, status, posted_at, updated_at)
            values (${randomUUID()}, ${owner}, ${place.taskId}, ${place.workspaceId}, ${place.agentId}, 'branch-protection', 1, 5, 'Require a review on main', false, 'open', '2026-10-24T09:00:00Z', '2026-10-24T09:00:00Z')`;
        }

        yield* runWebMigrations();

        const placed = (agentId: string) =>
          Effect.map(
            sql<{
              readonly channelId: string;
            }>`select channel_id as "channelId" from inbox_item where agent_id = ${agentId}`,
            (rows) => rows.map((row) => row.channelId),
          );
        const now = new Date("2026-10-25T09:00:00Z");
        assert.deepEqual(yield* placed(deans.agentId), [
          yield* ensureGeneralChannel(deans.workspaceId, now),
        ]);
        assert.deepEqual(yield* placed(charless.agentId), [
          yield* ensureGeneralChannel(charless.workspaceId, now),
        ]);

        const since = yield* openAgent("dean");
        const posted = yield* postInboxThread(
          { userId: "dean", taskId: since.taskId, agentId: since.agentId },
          { key: "invite-copy", title: "Invitations shipped", body: "They go out on sign-up." },
        );
        assert.ok(Result.isSuccess(posted));
        assert.deepEqual(yield* placed(since.agentId), [
          yield* ensureGeneralChannel(since.workspaceId, now),
        ]);
        const generals = yield* sql<{
          readonly count: number;
        }>`select count(*)::int as count from channel where name = 'general'`;
        assert.deepEqual(generals, [{ count: 3 }], "one #general per workspace");
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
