import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { readPageById, writePage } from "../plan-pages.js";
import { createTask } from "../task-store.js";

/**
 * A task's pages read by the page's id alone, over a real dialect: any
 * member of the task's workspace reads the newest version or one named,
 * beside the task it stands on and its newest version, and an account
 * outside the workspace, or a version the page never had, reads nothing.
 *
 * Synthetic accounts and pages throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

it.layer(getTestDB())("a page read by its id", (it) => {
  it.effect(
    "a member reads a teammate's page by its id, its newest version or one named, with its task and newest version, and an outsider or a version never written reads nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
        const first = Option.getOrThrow(
          yield* writePage(owner, task.id, { title: "Invites", html: "<h1>One</h1>" }),
        );
        yield* writePage(owner, task.id, {
          pageId: first.id,
          title: "Invites by week",
          html: "<h1>Two</h1>",
        });

        const newest = Option.getOrThrow(yield* readPageById(teammate, first.id, undefined));
        const earlier = Option.getOrThrow(yield* readPageById(teammate, first.id, 1));

        assert.deepEqual(
          [
            newest.taskId,
            newest.page.version,
            newest.page.title,
            newest.page.html,
            newest.newestVersion,
          ],
          [task.id, 2, "Invites by week", "<h1>Two</h1>", 2],
        );
        assert.deepEqual(
          [earlier.page.version, earlier.page.html, earlier.newestVersion],
          [1, "<h1>One</h1>", 2],
        );
        assert.ok(Option.isNone(yield* readPageById(outsider, first.id, undefined)));
        assert.ok(Option.isNone(yield* readPageById(teammate, first.id, 3)));
        assert.ok(Option.isNone(yield* readPageById(teammate, randomUUID(), undefined)));
      }),
  );
});
