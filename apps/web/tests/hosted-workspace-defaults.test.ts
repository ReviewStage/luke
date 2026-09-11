import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { readWorkspaceDefaults } from "../server/hosted/brain-host/defaults";
import { testSqlClient } from "./support/sql-client";

/**
 * The saved creation tie-breaks as the brain host reads them: an account that
 * saved none answers an empty record, a provider row with no default project
 * contributes nothing, and each field is absent rather than null, because the
 * projects context and the admission of a nameless creation both read absence.
 *
 * Synthetic accounts and provider ids throughout.
 */

const openUser = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const userId = `user-${randomUUID()}`;
  yield* sql`
    insert into "user" (id, name, email)
    values (${userId}, ${"Test User"}, ${`${userId}@luke.test`})
  `;
  return userId;
});

it.layer(testSqlClient)("the brain host's workspace defaults", (it) => {
  it.effect("an account that saved nothing names no provider and no project", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      assert.deepEqual(yield* readWorkspaceDefaults(userId), {});
    }),
  );

  it.effect("the saved provider and each provider's project come back by provider id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const userId = yield* openUser;
      yield* sql`
        insert into account_preference (user_id, default_workspace_provider)
        values (${userId}, ${"conductor"})
      `;
      yield* sql`
        insert into account_workspace_preference (user_id, provider_id, default_project_id)
        values (${userId}, ${"conductor"}, ${"project-a"})
      `;
      yield* sql`
        insert into account_workspace_preference (user_id, provider_id, default_project_id)
        values (${userId}, ${"superset"}, ${null})
      `;
      assert.deepEqual(yield* readWorkspaceDefaults(userId), {
        defaultProviderId: "conductor",
        defaultProjectIds: { conductor: "project-a" },
      });
    }),
  );

  it.effect("a preference row that names no provider leaves the field absent", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const userId = yield* openUser;
      yield* sql`insert into account_preference (user_id) values (${userId})`;
      assert.deepEqual(yield* readWorkspaceDefaults(userId), {});
    }),
  );
});
