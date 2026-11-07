import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Redacted, Result } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { parseKeyRing, sealWorkspaceVariable } from "../provider-key-seal.js";
import {
  listWorkspaceVariables,
  openWorkspaceEnvironment,
  removeWorkspaceVariable,
  setWorkspaceVariable,
} from "../workspace-environment-store.js";

/**
 * A workspace's shared environment variables, over a real dialect: a set
 * replaces the value of a name that stands, the list answers names alone,
 * a removal deletes the one name, and one workspace never reads another's.
 * Synthetic accounts, workspaces, keys, and values throughout.
 */

const AT = new Date("2026-11-06T12:00:00Z");
const LATER = new Date("2026-11-06T12:05:00Z");

const ring = Result.getOrThrow(
  parseKeyRing(Redacted.make(`1:${randomBytes(32).toString("base64")}`)),
);

const openOwnedWorkspace = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return yield* openWorkspace(userId);
});

const set = (organizationId: string, name: string, value: string, now: Date) =>
  setWorkspaceVariable(
    organizationId,
    name,
    sealWorkspaceVariable(ring, { organizationId, name }, Redacted.make(value)),
    now,
  );

it.layer(getTestDB())("the workspace environment store", (it) => {
  it.effect(
    "a set replaces the value of a name that stands, the list answers names alone, and a removal deletes one name",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openOwnedWorkspace;
        yield* set(workspace, "DATABASE_URL", "postgres://first", AT);
        yield* set(workspace, "API_TOKEN", "token-value", AT);
        yield* set(workspace, "DATABASE_URL", "postgres://second", LATER);

        const listed = yield* listWorkspaceVariables(workspace);
        assert.deepEqual(
          listed.map((row) => [row.name, row.updatedAt.getTime()]),
          [
            ["API_TOKEN", AT.getTime()],
            ["DATABASE_URL", LATER.getTime()],
          ],
        );
        assert.deepEqual(yield* openWorkspaceEnvironment(ring, workspace), {
          API_TOKEN: "token-value",
          DATABASE_URL: "postgres://second",
        });

        assert.equal(yield* removeWorkspaceVariable(workspace, "API_TOKEN"), true);
        assert.equal(yield* removeWorkspaceVariable(workspace, "API_TOKEN"), false);
        assert.deepEqual(yield* openWorkspaceEnvironment(ring, workspace), {
          DATABASE_URL: "postgres://second",
        });
      }),
  );

  it.effect("one workspace neither reads nor removes another's variables", () =>
    Effect.gen(function* () {
      const mine = yield* openOwnedWorkspace;
      const theirs = yield* openOwnedWorkspace;
      yield* set(theirs, "SECRET", "theirs", AT);

      assert.deepEqual(yield* listWorkspaceVariables(mine), []);
      assert.deepEqual(yield* openWorkspaceEnvironment(ring, mine), {});
      assert.equal(yield* removeWorkspaceVariable(mine, "SECRET"), false);
      assert.deepEqual(yield* openWorkspaceEnvironment(ring, theirs), { SECRET: "theirs" });
    }),
  );

  it.effect("a value sealed for another workspace or another name is left out, not opened", () =>
    Effect.gen(function* () {
      const mine = yield* openOwnedWorkspace;
      const theirs = yield* openOwnedWorkspace;
      const sealedFor = (organizationId: string, name: string) =>
        sealWorkspaceVariable(ring, { organizationId, name }, Redacted.make("moved"));
      yield* setWorkspaceVariable(mine, "FROM_THEIRS", sealedFor(theirs, "FROM_THEIRS"), AT);
      yield* setWorkspaceVariable(mine, "RENAMED", sealedFor(mine, "ORIGINAL"), AT);
      yield* set(mine, "KEPT", "kept", AT);

      assert.deepEqual(yield* openWorkspaceEnvironment(ring, mine), { KEPT: "kept" });
    }),
  );
});
