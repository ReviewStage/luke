import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@luke/database/core/migrator";
import { Database } from "@luke/database/core/query";
import {
  readAccountPreferences,
  writeAccountPreferences,
} from "@luke/database/models/account-store";
import { pinAgent } from "@luke/database/models/agent-store";
import { user } from "@luke/database/schemas/auth";
import { openWorkspace, unmigratedPgliteSqlClient } from "@luke/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * agent-columns-expand-migration.test.ts -- the migration that sets an `agent_*` column beside each `coding_agent*` one, over the release still serving beside it.
 *
 * Over a database migrated up to it, holding a pin and a default model
 * written in the old columns: once it runs, the new columns hold the same,
 * and for as long as both stand a write to either, by this release or by
 * the one before it, moves the other, so neither reads what the other did
 * not write. A second run of its backfill changes nothing. Synthetic
 * accounts throughout.
 */

const MIGRATION = "20261029023436_agent_columns_expand";

/** A migrations folder holding every migration named before `MIGRATION`'s, and none after. */
const foldersBefore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "luke-before-agent-columns-",
  });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(MIGRATION) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

/** An agent of dean's on no task, written in SQL, since the schema modules declare columns this database does not yet hold; its id. */
const openEarlierAgent = (workspaceId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const id = randomUUID();
    const conversationId = randomUUID();
    yield* sql`insert into conversations (id, user_id, kind) values (${conversationId}, 'dean', 'coding_agent')`;
    yield* sql`insert into agent (id, organization_id, user_id, conversation_id, model, effort, idempotency_key)
      values (${id}, ${workspaceId}, 'dean', ${conversationId}, 'anthropic/claude-opus-5.5', 'high', ${randomUUID()})`;
    return id;
  });

it.effect(
  "the old columns' pin and default model are the new columns' too, and a write to either pair moves the other",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore);
        yield* Database.use((db) =>
          db.insert(user).values({ id: "dean", name: "dean", email: "dean@luke.test" }),
        );
        const workspaceId = yield* openWorkspace("dean");
        const first = yield* openEarlierAgent(workspaceId);
        const second = yield* openEarlierAgent(workspaceId);
        yield* sql`insert into agent_pin (user_id, coding_agent_id, pinned_at) values ('dean', ${first}, now())`;
        yield* sql`insert into account_preference (user_id, coding_agent_model, coding_agent_effort, coding_agent_context_window)
          values ('dean', 'anthropic/claude-opus-5.5', 'high', 'standard')`;

        yield* runWebMigrations();

        const pins = sql<{
          readonly agentId: string;
          readonly codingAgentId: string;
          readonly position: string | null;
        }>`select agent_id as "agentId", coding_agent_id as "codingAgentId", position from agent_pin where user_id = 'dean' order by pinned_at, agent_id`;
        const agentChoice = Effect.map(readAccountPreferences("dean"), (row) => row?.agent);
        assert.deepEqual(yield* pins, [{ agentId: first, codingAgentId: first, position: null }]);
        assert.deepEqual(yield* agentChoice, {
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          contextWindow: "standard",
        });

        // This release pins the second agent; the one before moves that pin on its own key.
        yield* pinAgent("dean", second, true, "a1");
        yield* sql`insert into agent_pin (user_id, coding_agent_id, position, pinned_at) values ('dean', ${second}, 'a2', now())
          on conflict (user_id, coding_agent_id) do update set position = 'a2'`;
        assert.deepEqual(
          (yield* pins).find((pin) => pin.agentId === second),
          { agentId: second, codingAgentId: second, position: "a2" },
        );

        // This release writes the default model; the one before reads it, then writes its own.
        yield* writeAccountPreferences("dean", {
          agent: { model: "openai/gpt-5.5", effort: "low" },
        });
        assert.deepEqual(
          yield* sql`select coding_agent_model as model, coding_agent_effort as effort, coding_agent_context_window as "contextWindow" from account_preference where user_id = 'dean'`,
          [{ model: "openai/gpt-5.5", effort: "low", contextWindow: null }],
        );
        yield* sql`update account_preference set coding_agent_model = 'anthropic/claude-sonnet-5.5', coding_agent_effort = 'medium' where user_id = 'dean'`;
        assert.deepEqual(yield* agentChoice, {
          model: "anthropic/claude-sonnet-5.5",
          effort: "medium",
        });

        // A second run of the backfill, as a deploy that ran it before recording it would, changes nothing.
        const fileSystem = yield* FileSystem;
        const path = yield* Path;
        const backfill = (yield* fileSystem.readFileString(
          path.join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"),
        ))
          .split("--> statement-breakpoint")
          .filter((statement) => statement.trim().startsWith("UPDATE"));
        assert.equal(backfill.length, 4);
        const before = yield* pins;
        for (const statement of backfill) yield* sql.unsafe(statement);
        assert.deepEqual(yield* pins, before);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
