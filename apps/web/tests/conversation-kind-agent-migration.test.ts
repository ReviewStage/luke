import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@repo/database/core/migrator";
import { unmigratedPgliteSqlClient } from "@repo/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

const MIGRATIONS = [
  "20261029032309_conversation_kind_agent",
  "20261029032431_agent_sql_contract",
] as const;

const foldersBefore = (migration: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "before-kind-" });
    const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
      (name) => name.localeCompare(migration) < 0,
    );
    for (const name of names) {
      yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
    }
    return folder;
  });

const KINDS = [
  ["coding_agent", "agent"],
  ["coding_agent", "agent"],
  ["agent", "agent"],
  ["main", "main"],
  ["child", "child"],
] as const;

it.effect.each(MIGRATIONS)(
  "%s spells every agent's conversation `agent`, every other kind stands, and a second run changes nothing",
  (migration) =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore(migration));
        yield* sql`insert into "user" (id, name, email) values ('dean', 'dean', 'dean@app.test')`;
        for (const [order, [kind]] of KINDS.entries()) {
          yield* sql`insert into conversations (user_id, kind, created_at) values ('dean', ${kind}, ${new Date(order * 1000)})`;
        }
        const stored = Effect.map(
          sql<{
            readonly kind: string;
          }>`select kind from conversations where user_id = 'dean' order by created_at`,
          (rows) => rows.map((row) => row.kind),
        );

        yield* runWebMigrations();

        assert.deepEqual(
          yield* stored,
          KINDS.map(([, after]) => after),
        );

        const fileSystem = yield* FileSystem;
        const path = yield* Path;
        const rewrites = (yield* fileSystem.readFileString(
          path.join(MIGRATIONS_FOLDER, migration, "migration.sql"),
        ))
          .split("--> statement-breakpoint")
          .filter((statement) => /^(--.*\n)*UPDATE "conversations"/u.test(statement.trim()));
        assert.ok(rewrites.length > 0, "the migration rewrites conversations");
        for (const statement of rewrites) yield* sql.unsafe(statement);
        assert.deepEqual(
          yield* stored,
          KINDS.map(([, after]) => after),
        );
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
