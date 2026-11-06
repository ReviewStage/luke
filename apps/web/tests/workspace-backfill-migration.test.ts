import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@repo/database/core/migrator";
import { unmigratedPgliteSqlClient } from "@repo/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

const BACKFILL = "20261013231123_personal_workspace_backfill";

const foldersBeforeBackfill = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "before-backfill-" });
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
          values ('ada', 'Ada', 'ada@app.test', now(), now())`;
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
