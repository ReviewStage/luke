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
 * The migration that lets a workspace hold several GitHub installations,
 * over a database that already holds connected workspaces and their plans:
 * every installation row and every plan stands as it was, no installation
 * has to be connected again, a workspace then takes a second installation
 * while an installation still stands for one workspace alone, a run of the
 * migration's statements again changes nothing, and the writer from before
 * it, which replaced a workspace's installation by keying on the workspace,
 * fails against it rather than replacing anything. Synthetic ids throughout.
 */

const MIGRATION = "20261015174747_github_installation_per_workspace_many";

/** A migrations folder holding every migration named before this one, and none after. */
const foldersBeforeMigration = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "luke-before-installations-",
  });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(MIGRATION) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

/** The migration's own statements, as the runner splits them. */
const migrationStatements = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const text = yield* fileSystem.readFileString(
    path.join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"),
  );
  return text
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
});

interface InstallationRow {
  readonly organization_id: string;
  readonly installation_id: string;
  readonly account_id: string;
  readonly account_login: string;
  readonly account_type: string;
  readonly status: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const installationRows = (sql: SqlClient.SqlClient) =>
  sql<InstallationRow>`
    select organization_id, installation_id::text, account_id::text, account_login,
      account_type, status, created_at, updated_at
    from github_installation order by installation_id
  `;

/** Whether the statement fails, which a constraint refusing it is. */
const refused = <A, E, R>(statement: Effect.Effect<A, E, R>) =>
  Effect.match(statement, { onFailure: () => true, onSuccess: () => false });

it.effect(
  "connected workspaces keep every installation and plan, take a second installation, and refuse the writer from before",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBeforeMigration);
        yield* sql`insert into "user" (id, name, email, created_at, updated_at)
          values ('ada', 'Ada', 'ada@luke.test', now(), now())`;
        yield* sql`insert into organization (id, name, slug, created_at)
          values ('acme', 'Acme', 'acme', now()), ('zeta', 'Zeta', 'zeta', now())`;
        yield* sql`insert into member (id, organization_id, user_id, role, created_at)
          values ('m-acme', 'acme', 'ada', 'owner', now()), ('m-zeta', 'zeta', 'ada', 'owner', now())`;
        yield* sql`insert into github_installation
          (organization_id, installation_id, account_id, account_login, account_type, status, created_at, updated_at)
          values
            ('acme', 101, 9001, 'acme-org', 'Organization', 'active', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
            ('zeta', 202, 9002, 'zeta-org', 'Organization', 'suspended', '2026-10-03T00:00:00Z', '2026-10-04T00:00:00Z')`;
        yield* sql`insert into plan (id, user_id, organization_id, name, document, repository)
          values ('00000000-0000-4000-8000-000000000001', 'ada', 'acme', 'Invites', '## Goal', 'acme-org/relay')`;
        const before = yield* installationRows(sql);

        yield* runWebMigrations();

        assert.deepEqual(yield* installationRows(sql), before);
        assert.deepEqual(yield* sql`select organization_id, repository from task`, [
          { organization_id: "acme", repository: "acme-org/relay" },
        ]);
        yield* sql`insert into github_installation
          (organization_id, installation_id, account_id, account_login, account_type, status, created_at, updated_at)
          values ('acme', 303, 9003, 'acme-labs', 'Organization', 'active', now(), now())`;
        assert.deepEqual(
          (yield* sql<{ readonly installation_id: string }>`
            select installation_id::text from github_installation
            where organization_id = 'acme' order by installation_id
          `).map((row) => row.installation_id),
          ["101", "303"],
        );
        assert.equal(
          yield* refused(sql`insert into github_installation
            (organization_id, installation_id, account_id, account_login, account_type, status, created_at, updated_at)
            values ('zeta', 101, 9004, 'other', 'User', 'active', now(), now())`),
          true,
          "an installation stands for one workspace alone",
        );
        assert.equal(
          yield* refused(sql`insert into github_installation
            (organization_id, installation_id, account_id, account_login, account_type, status, created_at, updated_at)
            values (null, 404, 9005, 'nobody', 'User', 'active', now(), now())`),
          true,
          "an installation stands for some workspace",
        );
        assert.equal(
          yield* refused(sql`insert into github_installation
            (organization_id, installation_id, account_id, account_login, account_type, status, created_at, updated_at)
            values ('acme', 505, 9002, 'zeta-org', 'Organization', 'active', now(), now())
            on conflict (organization_id) do update set installation_id = excluded.installation_id`),
          true,
          "the writer keyed on the workspace finds no key to replace on",
        );

        const standing = yield* installationRows(sql);
        for (const statement of yield* migrationStatements) yield* sql.unsafe(statement);
        assert.deepEqual(yield* installationRows(sql), standing);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
