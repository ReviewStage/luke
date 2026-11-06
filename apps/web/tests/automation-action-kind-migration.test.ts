import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@repo/database/core/migrator";
import { openWorkspace, unmigratedPgliteSqlClient } from "@repo/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

const MIGRATION = "20261029013202_automation_action_kind_agent";
const STRAGGLERS = "20261029030257_automation_action_kind_agent_stragglers";

function foldersWhere(keep: (name: string) => boolean) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "action-kind-" });
    const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(keep);
    for (const name of names) {
      yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
    }
    return folder;
  });
}

const BEFORE = [
  { kind: "coding-agent", prompt: "Triage today's issues.", disabledServers: ["sentry"] },
  { kind: "agent", prompt: "Sweep the flaky tests." },
] as const;

it.effect.each([MIGRATION, STRAGGLERS])(
  "%s spells every automation's action kind `agent`, the rest of its action kept, and a second run changes nothing",
  (migration) =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersWhere((name) => name.localeCompare(migration) < 0));
        yield* sql`insert into "user" (id, name, email) values ('dean', 'dean', 'dean@app.test')`;
        const workspaceId = yield* openWorkspace("dean");
        for (const [order, action] of BEFORE.entries()) {
          yield* sql`insert into automation (user_id, organization_id, name, enabled, trigger_kind, trigger, action, guards)
            values ('dean', ${workspaceId}, ${`automation-${order}`}, true, 'webhook', '{"kind":"webhook"}'::jsonb, ${JSON.stringify(action)}::jsonb, '{"maxConcurrentRuns":1,"dailyRunCap":1}'::jsonb)`;
        }
        const stored = sql<{
          readonly action: unknown;
        }>`select action from automation where organization_id = ${workspaceId} order by name`;

        yield* runWebMigrations(yield* foldersWhere((name) => name.localeCompare(migration) <= 0));

        const rows = yield* stored;
        assert.deepEqual(
          rows.map((row) => row.action),
          [
            { kind: "agent", prompt: "Triage today's issues.", disabledServers: ["sentry"] },
            { kind: "agent", prompt: "Sweep the flaky tests." },
          ],
        );

        const fileSystem = yield* FileSystem;
        const path = yield* Path;
        yield* sql.unsafe(
          yield* fileSystem.readFileString(
            path.join(MIGRATIONS_FOLDER, migration, "migration.sql"),
          ),
        );
        assert.deepEqual(yield* stored, rows);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
