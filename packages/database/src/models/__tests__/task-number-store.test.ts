import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { organization, user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { taskIdOfNumber } from "../task-number-store.js";
import { createTask, updateTask } from "../task-store.js";

/**
 * A task found by its workspace's slug and its number, as a link
 * `/<slug>/task/<number>` names it, through the store's public functions
 * over a real dialect: a member finds it, by its old number too once it
 * moved, and an account outside the workspace finds nothing.
 *
 * Synthetic accounts, workspaces, and tasks throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const slugOf = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, organizationId));
    return row?.slug ?? assert.fail("the workspace was not written");
  });

it.layer(getTestDB())("a task found by its number", (it) => {
  it.effect(
    "a member finds the task its number names under the workspace's slug or id, and another account, or a number naming no task, finds nothing",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const charles = yield* openAccount;
        const stranger = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        yield* joinWorkspace(workspace, charles);
        yield* openWorkspace(stranger);
        yield* createTask(dean, { name: "Schema", organizationId: workspace });
        const sidebar = yield* createTask(dean, { name: "Sidebar", organizationId: workspace });
        const slug = yield* slugOf(workspace);

        assert.deepEqual(yield* taskIdOfNumber(charles, slug, 2), Option.some(sidebar.id));
        assert.deepEqual(yield* taskIdOfNumber(charles, workspace, 2), Option.some(sidebar.id));
        assert.deepEqual(yield* taskIdOfNumber(stranger, slug, 2), Option.none());
        assert.deepEqual(yield* taskIdOfNumber(stranger, workspace, 2), Option.none());
        assert.deepEqual(yield* taskIdOfNumber(dean, slug, 3), Option.none());
      }),
  );

  it.effect(
    "a task moved to another workspace is found by its old number there and its new one where it landed",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const charles = yield* openAccount;
        const workspace = yield* openWorkspace(dean);
        const elsewhere = yield* openWorkspace(dean);
        yield* joinWorkspace(workspace, charles);
        yield* createTask(dean, { name: "Kept", organizationId: elsewhere });
        const moving = yield* createTask(dean, { name: "Moving", organizationId: workspace });
        yield* updateTask(dean, moving.id, { organizationId: elsewhere });
        const [from, to] = [yield* slugOf(workspace), yield* slugOf(elsewhere)];

        assert.deepEqual(yield* taskIdOfNumber(dean, from, 1), Option.some(moving.id));
        assert.deepEqual(yield* taskIdOfNumber(dean, to, 2), Option.some(moving.id));
        // Charles is a member of the workspace it left, and no longer reaches the task where it landed.
        assert.deepEqual(yield* taskIdOfNumber(charles, from, 1), Option.none());
      }),
  );
});
