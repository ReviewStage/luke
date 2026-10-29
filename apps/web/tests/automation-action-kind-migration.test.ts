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
 * automation-action-kind-migration.test.ts -- the migrations that spell every stored automation's action kind `agent`.
 *
 * Over a database migrated up to each, holding an automation in each
 * spelling an earlier build wrote: once it runs, both say `agent` and keep
 * the rest of their action as it stood; a second run changes nothing. The
 * stragglers migration rewrites the rows a release still serving beside the
 * first wrote as `coding-agent`, so that migration leaves none behind.
 * Synthetic accounts throughout.
 */

const MIGRATION = "20261029013202_automation_action_kind_agent";
const STRAGGLERS = "20261029015642_automation_action_kind_agent_stragglers";

/** A migrations folder holding the migrations whose names `keep` takes, and no other. */
function foldersWhere(keep: (name: string) => boolean) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-action-kind-" });
    const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(keep);
    for (const name of names) {
      yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
    }
    return folder;
  });
}

/** Each action as an earlier build stored it, in order. */
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

        yield* runWebMigrations(yield* foldersWhere((name) => name.localeCompare(migration) <= 0));

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
            path.join(MIGRATIONS_FOLDER, migration, "migration.sql"),
          ),
        );
        assert.deepEqual(yield* stored, rows);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
