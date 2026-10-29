import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@luke/database/core/migrator";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { openWorkspace, unmigratedPgliteSqlClient } from "@luke/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * automation-action-kind-migration.test.ts -- the migration that spells every stored automation's action kind `agent`.
 *
 * Over a database migrated up to it, holding an automation in each spelling
 * an earlier build wrote: once it runs, both say `agent` and keep the rest
 * of their action as it stood; a second run changes nothing. Synthetic
 * accounts throughout.
 */

const MIGRATION = "20261029013202_automation_action_kind_agent";

/** A migrations folder holding every migration named before `MIGRATION`'s, and none after. */
const foldersBefore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-before-action-kind-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(MIGRATION) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

/** Each action as an earlier build stored it, in order. */
const BEFORE = [
  { kind: "coding-agent", prompt: "Triage today's issues.", disabledServers: ["sentry"] },
  { kind: "agent", prompt: "Sweep the flaky tests." },
] as const;

it.effect(
  "every automation's action kind is spelled `agent`, the rest of its action kept, and a second run changes nothing",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore);
        yield* Database.use((db) =>
          db.insert(user).values({ id: "dean", name: "dean", email: "dean@luke.test" }),
        );
        const workspaceId = yield* openWorkspace("dean");
        for (const [order, action] of BEFORE.entries()) {
          yield* sql`insert into automation (user_id, organization_id, name, enabled, trigger_kind, trigger, action, guards)
            values ('dean', ${workspaceId}, ${`automation-${order}`}, true, 'webhook', '{"kind":"webhook"}'::jsonb, ${JSON.stringify(action)}::jsonb, '{"maxConcurrentRuns":1,"dailyRunCap":1}'::jsonb)`;
        }
        const stored = sql<{
          readonly action: unknown;
        }>`select action from automation where organization_id = ${workspaceId} order by name`;

        yield* runWebMigrations();

        const rows = yield* stored;
        assert.deepEqual(
          rows.map((row) => row.action),
          [
            { kind: "agent", prompt: "Triage today's issues.", disabledServers: ["sentry"] },
            { kind: "agent", prompt: "Sweep the flaky tests." },
          ],
        );

        // A second run, as a deploy that ran it before recording it would, changes nothing.
        const fileSystem = yield* FileSystem;
        const path = yield* Path;
        yield* sql.unsafe(
          yield* fileSystem.readFileString(
            path.join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"),
          ),
        );
        assert.deepEqual(yield* stored, rows);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
