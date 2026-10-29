import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@luke/database/core/migrator";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { unmigratedPgliteSqlClient } from "@luke/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * conversation-kind-agent-migration.test.ts -- the migration that spells every agent's conversation kind `agent`.
 *
 * Over a database migrated up to it, holding a conversation of each kind an
 * earlier build wrote: once it runs, every `coding_agent` says `agent` and
 * every other kind stands as it was; a second run changes nothing.
 * Synthetic accounts throughout.
 */

const MIGRATION = "20261029032309_conversation_kind_agent";

/** A migrations folder holding every migration named before `MIGRATION`'s, and none after. */
const foldersBefore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-before-kind-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(MIGRATION) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

/** Each conversation's kind as an earlier build stored it, in order, and as it reads once the migration has run. */
const KINDS = [
  ["coding_agent", "agent"],
  ["coding_agent", "agent"],
  ["agent", "agent"],
  ["main", "main"],
  ["child", "child"],
] as const;

it.effect(
  "every agent's conversation is spelled `agent`, every other kind stands, and a second run changes nothing",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore);
        yield* Database.use((db) =>
          db.insert(user).values({ id: "dean", name: "dean", email: "dean@luke.test" }),
        );
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

        // A second run, as a deploy that ran it before recording it would, changes nothing.
        const fileSystem = yield* FileSystem;
        const path = yield* Path;
        const statements = (yield* fileSystem.readFileString(
          path.join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"),
        )).split("--> statement-breakpoint");
        for (const statement of statements) yield* sql.unsafe(statement);
        assert.deepEqual(
          yield* stored,
          KINDS.map(([, after]) => after),
        );
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
