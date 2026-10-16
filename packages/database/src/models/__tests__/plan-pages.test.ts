import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { PAGE_SHOWER, type PageShower } from "@luke/features/page-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { planPageVersion } from "../../schemas/plan-page.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { listPages, readPageById, readPageVersion, writePage } from "../plan-pages.js";
import { createTask } from "../task-store.js";

/**
 * A task's pages read by the page's id alone, over a real dialect: any
 * member of the task's workspace reads the newest version or one named,
 * beside the task it stands on and its newest version, and an account
 * outside the workspace, or a version the page never had, reads nothing.
 * Each version keeps who showed it, Luke or a coding agent by its id, which
 * a member reads on the plan's list and on the version, and a version shown
 * before that was kept reads as shown by no one named.
 *
 * Synthetic accounts and pages throughout.
 */

const LUKE: PageShower = { kind: PAGE_SHOWER.LUKE };

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
          yield* writePage(owner, task.id, { title: "Invites", html: "<h1>One</h1>" }, LUKE),
        );
        yield* writePage(
          owner,
          task.id,
          { pageId: first.id, title: "Invites by week", html: "<h1>Two</h1>" },
          LUKE,
        );

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

  it.effect(
    "each version keeps who showed it, which a member reads on the plan's list and on the version, an outsider reads nothing of, and one shown before it was kept names no one",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
        const agent: PageShower = { kind: PAGE_SHOWER.AGENT, agentId: randomUUID() };
        const shown = Option.getOrThrow(
          yield* writePage(owner, task.id, { title: "Invites", html: "<h1>One</h1>" }, agent),
        );
        yield* writePage(
          owner,
          task.id,
          { pageId: shown.id, title: "Invites", html: "<h1>Two</h1>" },
          LUKE,
        );
        const older = Option.getOrThrow(
          yield* writePage(owner, task.id, { title: "Old", html: "<h1>Old</h1>" }, LUKE),
        );
        // A version shown before who showed it was kept, as the column's migration leaves it.
        const db = yield* Database;
        yield* db
          .update(planPageVersion)
          .set({ shownBy: null })
          .where(eq(planPageVersion.pageId, older.id));

        const listed = yield* listPages(teammate, task.id);
        const first = yield* readPageVersion(teammate, task.id, shown.id, 1);

        assert.deepEqual(
          // Pages written in the same millisecond list in no particular order, so they are read by title.
          listed
            .map((page) => [page.title, page.shownBy] as const)
            .toSorted(([one], [other]) => one.localeCompare(other)),
          [
            ["Invites", LUKE],
            ["Old", undefined],
          ],
        );
        assert.deepEqual(
          Option.map(first, (page) => page.shownBy),
          Option.some(agent),
        );
        assert.deepEqual(yield* listPages(outsider, task.id), []);
        assert.ok(Option.isNone(yield* readPageVersion(outsider, task.id, shown.id, 1)));
      }),
  );
});
