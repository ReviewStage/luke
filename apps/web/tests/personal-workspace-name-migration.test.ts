import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@luke/database/core/migrator";
import { unmigratedPgliteSqlClient } from "@luke/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * personal-workspace-name-migration.test.ts -- the backfill that gives an account's first workspace made as "Personal" its owner's name.
 *
 * Over a database migrated up to the backfill, holding a first workspace made
 * as "Personal" while #2740 stood, one made before it under its account's
 * name, and a team someone called "Personal": the backfill renames the first
 * alone, and a second run changes nothing. Synthetic accounts throughout.
 */

const BACKFILL = "20261015131300_personal_workspace_owner_name";

/** A migrations folder holding every migration named before the backfill, and none after. */
const foldersBeforeBackfill = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-before-backfill-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(BACKFILL) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

it.effect(
  "a first workspace made as Personal takes its owner's name, and neither an older first workspace nor a team called Personal is renamed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBeforeBackfill);
        yield* sql`insert into "user" (id, name, email, created_at, updated_at) values
          ('ada', 'Ada Lovelace', 'ada@luke.test', now(), now()),
          ('grace', 'Grace Hopper', 'grace@luke.test', now(), now())`;
        yield* sql`insert into organization (id, name, slug, created_at, metadata) values
          ('ada-first', 'Personal', 'personal-ada', '2026-10-15 09:00:00+00', '{"personal":true}'),
          ('grace-first', 'Grace', 'personal-grace', '2026-10-14 09:00:00+00', '{"personal":true}'),
          ('team', 'Personal', 'team', '2026-10-15 09:00:00+00', '{}')`;
        yield* sql`insert into personal_workspace (user_id, organization_id, created_at) values
          ('ada', 'ada-first', now()),
          ('grace', 'grace-first', now())`;
        const names = sql<{ readonly id: string; readonly name: string }>`
          select id, name from organization order by id
        `;

        yield* runWebMigrations();
        const migrated = yield* names;
        yield* sql`delete from __drizzle_migrations where name = ${BACKFILL}`;
        yield* runWebMigrations();

        const expected = [
          { id: "ada-first", name: "Ada Lovelace" },
          { id: "grace-first", name: "Grace" },
          { id: "team", name: "Personal" },
        ];
        assert.deepEqual(migrated, expected);
        assert.deepEqual(yield* names, expected);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
