import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@sidecar/database/core/migrator";
import { unmigratedPgliteSqlClient } from "@sidecar/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The personal workspace backfill over a database that already holds an
 * account's personal organization without the row naming it the account's,
 * as an ensure that made the organization and not yet the row leaves it:
 * the backfill adopts that organization rather than leaving the account
 * without a row, which the plan backfill after it reads every plan's
 * workspace from, and makes no second one. Synthetic accounts throughout.
 */

const BACKFILL = "20261013231123_personal_workspace_backfill";

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
  "an account whose personal organization stands without its row adopts it, and gets no second one",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBeforeBackfill);
        yield* sql`insert into "user" (id, name, email, created_at, updated_at)
          values ('ada', 'Ada', 'ada@luke.test', now(), now())`;
        yield* sql`insert into organization (id, name, slug, created_at, metadata)
          values ('standing', 'Ada', 'personal-ada', now(), '{"personal":true}')`;
        yield* sql`insert into member (id, organization_id, user_id, role, created_at)
          values ('owner', 'standing', 'ada', 'owner', now())`;

        yield* runWebMigrations();

        const rows = yield* sql<{ readonly organization_id: string }>`
          select organization_id from personal_workspace where user_id = 'ada'
        `;
        assert.deepEqual(
          rows.map((row) => row.organization_id),
          ["standing"],
        );
        const organizations = yield* sql`select id from organization`;
        assert.equal(organizations.length, 1);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
