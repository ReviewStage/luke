import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  MIGRATIONS_TABLE,
  runWebMigrations,
  webMigrationJournal,
  webMigrations,
} from "@sidecar/database/core/migrator";
import { db } from "@sidecar/database/core/query";
import { oauthClient } from "@sidecar/database/schemas/auth";
import { unmigratedPgliteSqlClient } from "@sidecar/database/testing";
import { asc } from "drizzle-orm";
import { Effect, Layer } from "effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Migration 0081 carries out step 2 of Better Auth's 1.7 upgrade guide for
 * `@better-auth/oauth-provider`: a client's 1.6 `type` of `web` or `native`
 * is mapped to 1.7's `applicationType`, since 1.7 reads only the latter.
 * The rows are written while the database stands at 0080, as a deployed
 * one does, and read back once the rest of the folder has run.
 */

const UPGRADE_TAG = "0081_better_auth_1_7";

/** The folder's migrations up to, and not including, the upgrade's own. */
const migrateBeforeUpgrade = Effect.gen(function* () {
  const upgrade = (yield* webMigrationJournal()).find((entry) => entry.tag === UPGRADE_TAG);
  assert.ok(upgrade);
  const before = Effect.map(webMigrations(), (migrations) =>
    migrations.filter(([id]) => id <= upgrade.idx),
  );
  yield* Migrator.make({})({ loader: before, table: MIGRATIONS_TABLE });
});

function insertClient(clientId: string, type: string | null) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      insert into oauth_client (id, client_id, redirect_uris, type)
      values (${clientId}, ${clientId}, ${["http://127.0.0.1/callback"]}, ${type})
    `;
  });
}

it.effect("the upgrade maps a 1.6 client's web or native type to its application type", () =>
  Effect.gen(function* () {
    yield* migrateBeforeUpgrade;
    yield* insertClient("native-client", "native");
    yield* insertClient("web-client", "web");
    yield* insertClient("untyped-client", null);

    yield* runWebMigrations();

    const clients = yield* db
      .select({
        clientId: oauthClient.clientId,
        applicationType: oauthClient.applicationType,
        clientCredentialsScopes: oauthClient.clientCredentialsScopes,
      })
      .from(oauthClient)
      .orderBy(asc(oauthClient.clientId));
    assert.deepEqual(clients, [
      { clientId: "native-client", applicationType: "native", clientCredentialsScopes: [] },
      { clientId: "untyped-client", applicationType: null, clientCredentialsScopes: [] },
      { clientId: "web-client", applicationType: "web", clientCredentialsScopes: [] },
    ]);
  }).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
