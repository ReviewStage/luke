import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { WORKSPACE_ENVIRONMENT_KIND } from "@luke/features/workspace-environment-wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Redacted, Result } from "effect";
import { Database } from "../../core/query.js";
import { member, organization, user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  type KeyRing,
  openEnvironmentValue,
  parseKeyRing,
  rewrapEnvironmentValue,
  sealEnvironmentValue,
} from "../provider-key-seal.js";
import {
  listEveryWorkspaceEnvironmentRow,
  listWorkspaceEnvironmentRows,
  removeWorkspaceEnvironmentValue,
  rewrapWorkspaceEnvironmentRow,
  saveWorkspaceEnvironmentValue,
  sealedOf,
} from "../workspace-environment-store.js";

/**
 * A workspace's environment over a real dialect: values kept sealed and
 * opened again for the workspace and name they were saved under alone, a
 * name saved again replaced whole, of whichever kind, removed, kept to the
 * workspace that saved it, and gone with its workspace; and a rotation's
 * rewrap moves only the row it read.
 *
 * Synthetic accounts, workspaces, and keys throughout.
 */

/** A ring of two synthetic versions, the second current, as a rotation leaves one. */
function ringOf(entries: string): KeyRing {
  return Result.getOrThrow(parseKeyRing(Redacted.make(entries)));
}

const OLD_KEY = `1:${Buffer.alloc(32, 1).toString("base64")}`;
const NEW_KEY = `2:${Buffer.alloc(32, 2).toString("base64")}`;
const OLD_RING = ringOf(OLD_KEY);
const ROTATED_RING = ringOf(`${NEW_KEY},${OLD_KEY}`);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A workspace the account owns, as the organization plugin would leave the rows. */
const openWorkspace = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const organizationId = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(organization).values({
      id: organizationId,
      name: "Acme",
      slug: `workspace-${organizationId}`,
      createdAt: now,
    });
    yield* db
      .insert(member)
      .values({ id: randomUUID(), organizationId, userId, role: "owner", createdAt: now });
    return organizationId;
  });

/** Saves a value sealed for the workspace and name, under the ring given. */
const save = (
  ring: KeyRing,
  organizationId: string,
  userId: string,
  name: string,
  kind: (typeof WORKSPACE_ENVIRONMENT_KIND)[keyof typeof WORKSPACE_ENVIRONMENT_KIND],
  value: string,
) =>
  Effect.gen(function* () {
    const sealed = sealEnvironmentValue(ring, { organizationId, name }, Redacted.make(value));
    const now = yield* DateTime.nowAsDate;
    yield* saveWorkspaceEnvironmentValue(organizationId, name, kind, sealed, "…hint", userId, now);
  });

/** What a workspace's rows open to, by name, under the ring given. */
const opened = (ring: KeyRing, organizationId: string) =>
  Effect.map(listWorkspaceEnvironmentRows(organizationId), (rows) =>
    rows.map((row) => [
      row.name,
      row.kind,
      Result.map(
        openEnvironmentValue(ring, { organizationId, name: row.name }, sealedOf(row)),
        Redacted.value,
      ),
    ]),
  );

it.layer(getTestDB())("the workspace environment store", (it) => {
  it.effect("keeps each value sealed and opens it for its workspace and name, by name", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);

      yield* save(
        OLD_RING,
        workspace,
        owner,
        "STRIPE_KEY",
        WORKSPACE_ENVIRONMENT_KIND.SECRET,
        "sk_test_1",
      );
      yield* save(
        OLD_RING,
        workspace,
        owner,
        "APP_MODE",
        WORKSPACE_ENVIRONMENT_KIND.VARIABLE,
        "development",
      );

      assert.deepEqual(yield* opened(OLD_RING, workspace), [
        ["APP_MODE", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, Result.succeed("development")],
        ["STRIPE_KEY", WORKSPACE_ENVIRONMENT_KIND.SECRET, Result.succeed("sk_test_1")],
      ]);
      const [row] = yield* listWorkspaceEnvironmentRows(workspace);
      assert.ok(row !== undefined && !row.sealedValue.includes("development"));
    }),
  );

  it.effect("opens nothing for a workspace or a name a value was not saved under", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      yield* save(OLD_RING, workspace, owner, "TOKEN", WORKSPACE_ENVIRONMENT_KIND.SECRET, "abc123");
      const [row] = yield* listWorkspaceEnvironmentRows(workspace);
      assert.ok(row !== undefined);

      const elsewhere = openEnvironmentValue(
        OLD_RING,
        { organizationId: randomUUID(), name: "TOKEN" },
        sealedOf(row),
      );
      const renamed = openEnvironmentValue(
        OLD_RING,
        { organizationId: workspace, name: "OTHER" },
        sealedOf(row),
      );

      assert.ok(Result.isFailure(elsewhere));
      assert.ok(Result.isFailure(renamed));
    }),
  );

  it.effect("replaces a name saved again whole, its kind with it, and removes it", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);

      yield* save(OLD_RING, workspace, owner, "API_URL", WORKSPACE_ENVIRONMENT_KIND.SECRET, "one");
      yield* save(
        OLD_RING,
        workspace,
        owner,
        "API_URL",
        WORKSPACE_ENVIRONMENT_KIND.VARIABLE,
        "two",
      );
      const replaced = yield* opened(OLD_RING, workspace);
      yield* removeWorkspaceEnvironmentValue(workspace, "API_URL");

      assert.deepEqual(replaced, [
        ["API_URL", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, Result.succeed("two")],
      ]);
      assert.deepEqual(yield* listWorkspaceEnvironmentRows(workspace), []);
    }),
  );

  it.effect("keeps a workspace's values to it, and lets them go with it", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const owner = yield* openAccount;
      const ours = yield* openWorkspace(owner);
      const theirs = yield* openWorkspace(yield* openAccount);
      yield* save(OLD_RING, ours, owner, "SHARED", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "ours");

      yield* removeWorkspaceEnvironmentValue(theirs, "SHARED");
      const seenByThem = yield* listWorkspaceEnvironmentRows(theirs);
      const keptByUs = (yield* listWorkspaceEnvironmentRows(ours)).map((row) => row.name);
      yield* db.delete(organization).where(eq(organization.id, ours));

      assert.deepEqual(seenByThem, []);
      assert.deepEqual(keptByUs, ["SHARED"]);
      assert.deepEqual(yield* listWorkspaceEnvironmentRows(ours), []);
    }),
  );

  it.effect("moves a row onto the current version, but not one replaced since it was read", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      yield* save(OLD_RING, workspace, owner, "KEPT", WORKSPACE_ENVIRONMENT_KIND.SECRET, "kept");
      yield* save(
        OLD_RING,
        workspace,
        owner,
        "SWAPPED",
        WORKSPACE_ENVIRONMENT_KIND.SECRET,
        "before",
      );
      const read = (yield* listEveryWorkspaceEnvironmentRow()).filter(
        (row) => row.organizationId === workspace,
      );
      yield* save(
        OLD_RING,
        workspace,
        owner,
        "SWAPPED",
        WORKSPACE_ENVIRONMENT_KIND.SECRET,
        "after",
      );

      const moved = yield* Effect.forEach(read, (row) =>
        rewrapWorkspaceEnvironmentRow(
          row,
          Result.getOrThrow(rewrapEnvironmentValue(ROTATED_RING, row, sealedOf(row))),
        ),
      );
      const versions = (yield* listWorkspaceEnvironmentRows(workspace)).map((row) => [
        row.name,
        row.keyVersion,
      ]);

      assert.deepEqual(moved, [true, false]);
      assert.deepEqual(versions, [
        ["KEPT", 2],
        ["SWAPPED", 1],
      ]);
      assert.deepEqual(yield* opened(ROTATED_RING, workspace), [
        ["KEPT", WORKSPACE_ENVIRONMENT_KIND.SECRET, Result.succeed("kept")],
        ["SWAPPED", WORKSPACE_ENVIRONMENT_KIND.SECRET, Result.succeed("after")],
      ]);
    }),
  );
});
