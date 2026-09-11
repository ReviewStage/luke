import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import {
  deleteAccount,
  readAccountPreferences,
  writeAccountPreferences,
} from "../server/hosted/account-store";

import { testSqlClient } from "./support/sql-client";

/**
 * The account group's own reads and writes against a real Postgres dialect.
 * The delete is the one action root AGENTS.md treats as unrecoverable, so
 * what is pinned here is the unit as well as the answer: the dependent rows
 * of exactly the named account go with it, another account's stand, and a
 * rewritten snapshot replaces its per-provider rows whole rather than
 * merging into what stood.
 *
 * Synthetic accounts, provider ids, and project ids throughout.
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

const countRows = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const preferences = yield* sql`
      select user_id from account_preference where user_id = ${userId}
    `;
    const workspaces = yield* sql`
      select provider_id from account_workspace_preference where user_id = ${userId}
    `;
    const usage = yield* sql`select day from hosted_usage where user_id = ${userId}`;
    return {
      preferences: preferences.length,
      workspaces: workspaces.length,
      usage: usage.length,
    };
  });

it.layer(testSqlClient)("the account group's seams over @effect/sql", (it) => {
  it.effect("an account that stored nothing reads as nothing", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      assert.equal(yield* readAccountPreferences(userId), undefined);
    }),
  );

  it.effect("a written snapshot reads back whole, at the instant it was written", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const written = yield* writeAccountPreferences(userId, {
        voice: "cedar",
        voiceSpeed: 1.25,
        defaultWorkspaceProvider: "conductor",
        workspaceProjectDefaults: { conductor: "project-a", superset: "project-b" },
        workspaceAgentDefaults: {
          conductor: { agent: "claude", model: "opus", effort: "high" },
          superset: { agent: "codex" },
        },
      });

      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.preferences, {
        voice: "cedar",
        voiceSpeed: 1.25,
        defaultWorkspaceProvider: "conductor",
        workspaceProjectDefaults: { conductor: "project-a", superset: "project-b" },
        workspaceAgentDefaults: {
          conductor: { agent: "claude", model: "opus", effort: "high" },
          superset: { agent: "codex" },
        },
      });
      assert.equal(read?.updatedAt.getTime(), written.getTime());
    }),
  );

  it.effect("a rewrite replaces the per-provider rows rather than merging into them", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* writeAccountPreferences(userId, {
        workspaceProjectDefaults: { conductor: "project-a", superset: "project-b" },
      });
      yield* writeAccountPreferences(userId, {
        voice: "marin",
        workspaceProjectDefaults: { conductor: "project-c" },
      });

      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.preferences, {
        voice: "marin",
        workspaceProjectDefaults: { conductor: "project-c" },
      });
      assert.deepEqual(yield* countRows(userId), {
        preferences: 1,
        workspaces: 1,
        usage: 0,
      });
    }),
  );

  it.effect("a value the vocabulary does not name is left out of the snapshot", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const userId = yield* openUser;
      yield* sql`
        insert into account_preference (user_id, voice, voice_speed)
        values (${userId}, ${"not-a-voice"}, ${0.5})
      `;
      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.preferences, {});
    }),
  );

  it.effect("the delete takes the account's dependent rows and leaves another's standing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const erased = yield* openUser;
      const kept = yield* openUser;
      for (const userId of [erased, kept]) {
        yield* writeAccountPreferences(userId, {
          voice: "cedar",
          workspaceProjectDefaults: { conductor: "project-a" },
        });
        yield* sql`
          insert into hosted_usage (user_id, day, calls) values (${userId}, ${"2099-01-01"}, ${3})
        `;
      }

      yield* deleteAccount(erased);

      const remaining = yield* sql`select id from "user" where id = ${erased}`;
      assert.equal(remaining.length, 0);
      assert.deepEqual(yield* countRows(erased), {
        preferences: 0,
        workspaces: 0,
        usage: 0,
      });
      assert.deepEqual(yield* countRows(kept), {
        preferences: 1,
        workspaces: 1,
        usage: 1,
      });
    }),
  );
});
