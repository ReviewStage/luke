import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { listRepositoryRuns, setRepositoryRun } from "../repository-run-store.js";

/**
 * A workspace's shared run commands, over a real dialect: set once, read by
 * the workspace alone, keyed by the repository's name without case, and
 * forgotten when both are cleared.
 *
 * Synthetic accounts and repositories throughout.
 */

const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` }),
  );
  return id;
});

it.layer(getTestDB())("the repository run store", (it) => {
  it.effect(
    "a repository's commands are the workspace's, by name without case, and another workspace reads none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const other = yield* openWorkspace(yield* openAccount);

        yield* setRepositoryRun(workspace, owner, {
          repository: "Octocat/Relay",
          setupCommand: "pnpm install",
          runCommand: "pnpm dev",
        });
        const changed = yield* setRepositoryRun(workspace, owner, {
          repository: "octocat/relay",
          setupCommand: null,
          runCommand: "pnpm start",
        });

        assert.deepEqual(changed, [
          { repository: "octocat/relay", setupCommand: null, runCommand: "pnpm start" },
        ]);
        assert.deepEqual(yield* listRepositoryRuns(other), []);
      }),
  );

  it.effect("clearing both commands forgets the repository", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      yield* setRepositoryRun(workspace, owner, {
        repository: "octocat/relay",
        setupCommand: null,
        runCommand: "make serve",
      });

      const cleared = yield* setRepositoryRun(workspace, owner, {
        repository: "octocat/relay",
        setupCommand: null,
        runCommand: null,
      });

      assert.deepEqual(cleared, []);
    }),
  );
});
