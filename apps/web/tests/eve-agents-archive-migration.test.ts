import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@repo/database/core/migrator";
import { Database } from "@repo/database/core/query";
import { archiveAgent, readAgent } from "@repo/database/models/agent-store";
import { createTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import {
  openInboxItem,
  openTaskAgent,
  openWorkspace,
  unmigratedPgliteSqlClient,
} from "@repo/database/testing";
import { Effect, Layer, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * eve-agents-archive-migration.test.ts -- the migration that archives every agent left on eve.
 *
 * Over a database migrated with every migration but it, holding agents on
 * eve, from before the runtime column, on Claude Code, and on eve but
 * archived by a member already: once it runs, the agents on eve or with no
 * runtime stand archived by the app for their starter, with why, the others
 * as they were; the archived agent's open question is closed and its ask
 * withdrawn, its notice and the Claude Code agent's question left open; a
 * second run changes nothing; and the starter's unarchive opens the
 * question again.
 * Synthetic accounts throughout.
 */

const MIGRATION = "20261102192712_eve_agents_archive";

/**
 * A migrations folder holding every migration but this one. Note that the
 * ones named after it are held too, because the agents are seeded through
 * the store, whose inserts name every column a later migration adds.
 */
const foldersBut = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "but-eve-archive-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name !== MIGRATION,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

it.effect(
  "an agent left on eve, or with no runtime, is archived by the app for its starter with why, its open questions settled, and every other agent stands as it was",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBut);
        yield* Database.use((db) =>
          db.insert(user).values({ id: "dean", name: "Dean", email: "dean@app.test" }),
        );
        const workspaceId = yield* openWorkspace("dean");
        const { id: taskId } = yield* createTask("dean", { organizationId: workspaceId });
        const agentOn = (runtime: string | null) =>
          Effect.gen(function* () {
            const agentId = yield* openTaskAgent("dean", workspaceId, taskId);
            yield* sql`update conversations set runtime = ${runtime} where id = (select conversation_id from agent where id = ${agentId})`;
            return agentId;
          });
        const onRetired = yield* agentOn("eve");
        const unnamed = yield* agentOn(null);
        const onClaudeCode = yield* agentOn("claude_code");
        const putAway = yield* agentOn("eve");
        yield* archiveAgent("dean", putAway, true);
        const question = yield* openInboxItem("dean", workspaceId, taskId, onRetired, true);
        const notice = yield* openInboxItem("dean", workspaceId, taskId, onRetired, false);
        const nativeQuestion = yield* openInboxItem(
          "dean",
          workspaceId,
          taskId,
          onClaudeCode,
          true,
        );

        yield* runWebMigrations();
        const archivedAt = (agentId: string) =>
          Effect.map(readAgent("dean", agentId), (agent) => Option.getOrThrow(agent).archivedAt);
        const stamped = yield* archivedAt(onRetired);
        yield* sql`delete from __drizzle_migrations where name = ${MIGRATION}`;
        yield* runWebMigrations();

        const archivedBy = (agentId: string) =>
          Effect.map(readAgent("dean", agentId), (agent) => Option.getOrThrow(agent).archivedBy);
        // Note that the migration stores the app as `luke`, its word then, which reads as the app's.
        const retired = {
          by: "app",
          userId: "dean",
          reason: "Its runtime was retired. Continue it in a new agent to go on from its work.",
        };
        assert.deepEqual(yield* archivedBy(onRetired), retired);
        assert.deepEqual(yield* archivedBy(unnamed), retired);
        assert.equal(yield* archivedBy(onClaudeCode), null);
        assert.deepEqual(yield* archivedBy(putAway), { by: "member", userId: "dean" });
        assert.deepEqual(
          yield* archivedAt(onRetired),
          stamped,
          "a second run stamps nothing again",
        );

        const standing = (itemId: string) =>
          Effect.gen(function* () {
            const [item] = yield* sql<{
              readonly status: string;
              readonly closedReason: string | null;
            }>`select status, closed_reason as "closedReason" from inbox_item where id = ${itemId}`;
            const asks = yield* sql<{
              readonly ask: { readonly status: string; readonly withdrawnReason?: string } | null;
            }>`select ask from inbox_message where item_id = ${itemId} and ask is not null`;
            return {
              status: item?.status,
              closedReason: item?.closedReason,
              asks: asks.map(({ ask }) => [ask?.status, ask?.withdrawnReason]),
            };
          });
        assert.deepEqual(yield* standing(question), {
          status: "closed",
          closedReason: "Its agent was archived.",
          asks: [["withdrawn", "Its agent was archived."]],
        });
        assert.deepEqual(yield* standing(notice), { status: "open", closedReason: null, asks: [] });
        assert.deepEqual(yield* standing(nativeQuestion), {
          status: "open",
          closedReason: null,
          asks: [["open", undefined]],
        });

        yield* archiveAgent("dean", onRetired, false);
        assert.deepEqual(yield* standing(question), {
          status: "open",
          closedReason: null,
          asks: [["open", undefined]],
        });
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
