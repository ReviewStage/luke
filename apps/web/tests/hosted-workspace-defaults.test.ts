import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { user } from "../server/db/auth-schema";
import { accountPreference, accountWorkspacePreference } from "../server/db/preferences-schema";
import { db } from "../server/db/query";
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
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
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
      const userId = yield* openUser;
      yield* db.insert(accountPreference).values({ userId, defaultWorkspaceProvider: "conductor" });
      yield* db
        .insert(accountWorkspacePreference)
        .values({ userId, providerId: "conductor", defaultProjectId: "project-a" });
      yield* db
        .insert(accountWorkspacePreference)
        .values({ userId, providerId: "superset", defaultProjectId: null });
      assert.deepEqual(yield* readWorkspaceDefaults(userId), {
        defaultProviderId: "conductor",
        defaultProjectIds: { conductor: "project-a" },
      });
    }),
  );

  it.effect(
    "a stored agent pairing the build lists rides back by provider id, effort included",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        yield* db.insert(accountWorkspacePreference).values({
          userId,
          providerId: "conductor",
          defaultProjectId: "project-a",
          agent: "claude",
          model: "fable-5-1",
          effort: "high",
        });
        assert.deepEqual(yield* readWorkspaceDefaults(userId), {
          defaultProjectIds: { conductor: "project-a" },
          agentDefaults: { conductor: { agent: "claude", model: "fable-5-1", effort: "high" } },
        });
      }),
  );

  it.effect("a pairing stored without an effort comes back without one", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* db.insert(accountWorkspacePreference).values({
        userId,
        providerId: "conductor",
        agent: "codex",
        model: "gpt-5.6-sol",
      });
      assert.deepEqual(yield* readWorkspaceDefaults(userId), {
        agentDefaults: { conductor: { agent: "codex", model: "gpt-5.6-sol" } },
      });
    }),
  );

  it.effect("a pairing the build's table no longer lists is nothing, never a request", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* db.insert(accountWorkspacePreference).values({
        userId,
        providerId: "conductor",
        agent: "claude",
        model: "retired-model",
        effort: "high",
      });
      yield* db.insert(accountWorkspacePreference).values({
        userId,
        providerId: "superset",
        agent: "claude",
        model: "fable-5-1",
        effort: "high",
      });
      assert.deepEqual(yield* readWorkspaceDefaults(userId), {});
    }),
  );

  it.effect("a preference row that names no provider leaves the field absent", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* db.insert(accountPreference).values({ userId });
      assert.deepEqual(yield* readWorkspaceDefaults(userId), {});
    }),
  );
});
