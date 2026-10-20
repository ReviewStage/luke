import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  addWorkspaceTokenRepository,
  listWorkspaceTokenRepositories,
  removeWorkspaceTokenRepository,
  workspaceTokenRepositoryAdder,
} from "../workspace-token-repository-store.js";

/**
 * The repositories members add to a workspace on their own tokens, over a
 * real dialect: every member of the workspace reads them, an account
 * outside it reads, adds, and removes none, and adding twice keeps the
 * first adder.
 *
 * Synthetic accounts, workspaces, and repositories throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

it.layer(getTestDB())("a workspace's token repositories", (it) => {
  it.effect("members share them, the first adder stands, and an outsider touches none", () =>
    Effect.gen(function* () {
      const [dean, charles, outsider] = [
        yield* openAccount,
        yield* openAccount,
        yield* openAccount,
      ];
      const workspace = yield* openWorkspace(dean);
      yield* joinWorkspace(workspace, charles);

      yield* addWorkspaceTokenRepository(charles, workspace, "acme/relay", new Date(1));
      yield* addWorkspaceTokenRepository(dean, workspace, "acme/relay", new Date(2));
      yield* addWorkspaceTokenRepository(dean, workspace, "acme/site", new Date(3));
      yield* removeWorkspaceTokenRepository(outsider, workspace, "acme/site");

      assert.deepEqual(yield* listWorkspaceTokenRepositories(dean, workspace), [
        { repository: "acme/site", addedByUserId: dean, addedAt: 3 },
        { repository: "acme/relay", addedByUserId: charles, addedAt: 1 },
      ]);
      assert.deepEqual(yield* listWorkspaceTokenRepositories(outsider, workspace), []);
      assert.deepEqual(
        yield* workspaceTokenRepositoryAdder(dean, workspace, "acme/relay"),
        Option.some(charles),
      );
      assert.ok(
        Option.isNone(yield* workspaceTokenRepositoryAdder(outsider, workspace, "acme/relay")),
      );

      yield* removeWorkspaceTokenRepository(charles, workspace, "acme/relay");
      assert.deepEqual(
        (yield* listWorkspaceTokenRepositories(charles, workspace)).map((row) => row.repository),
        ["acme/site"],
      );
    }),
  );
});
