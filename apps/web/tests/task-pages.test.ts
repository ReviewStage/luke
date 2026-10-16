import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { listPages, readPageVersion, writePage } from "@luke/database/models/plan-pages";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, startTask } from "@luke/database/testing";
import { Effect, Option } from "effect";

/**
 * A plan's pages, through the store's write and reads: a write is a page's
 * next version and every version stands as written, the plan lists each page
 * by its newest, a member of the plan's workspace reads and writes its pages
 * whoever started it, and a plan of a workspace the account is not in, or a
 * page the plan does not hold, reads and writes as none. Synthetic accounts, plans, and pages
 * throughout.
 */

const CHART = { title: "Invite funnel", html: "<!doctype html><p>v1</p>" } as const;
const CHART_AGAIN = { title: "Invite funnel, by week", html: "<!doctype html><p>v2</p>" } as const;
const MOCKUP = { title: "Invite dialog", html: "<!doctype html><button>Invite</button>" } as const;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

const openTask = Effect.gen(function* () {
  const userId = yield* openAccount;
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  return { userId, taskId: task.id, workspaceId: task.workspaceId };
});

/** A write the test expects to land, as the page it left. */
const written = (userId: string, taskId: string, write: Parameters<typeof writePage>[2]) =>
  Effect.map(writePage(userId, taskId, write), Option.getOrThrow);

it.layer(getTestDB())("a plan's pages", (it) => {
  it.effect("another account's plan lists, reads, and takes no page", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const other = yield* openAccount;
      const chart = yield* written(userId, taskId, CHART);

      assert.deepEqual(yield* listPages(other, taskId), []);
      assert.ok(Option.isNone(yield* readPageVersion(other, taskId, chart.id, 1)));
      assert.ok(Option.isNone(yield* writePage(other, taskId, MOCKUP)));
      assert.ok(Option.isNone(yield* writePage(other, taskId, { pageId: chart.id, ...MOCKUP })));
      assert.deepEqual(yield* listPages(userId, taskId), [chart]);
    }),
  );

  it.effect("a member of the plan's workspace reads and writes the pages a teammate wrote", () =>
    Effect.gen(function* () {
      const { userId, taskId, workspaceId } = yield* openTask;
      const teammate = yield* openAccount;
      yield* joinWorkspace(workspaceId, teammate);
      const first = yield* written(userId, taskId, CHART);

      const again = yield* written(teammate, taskId, { pageId: first.id, ...CHART_AGAIN });

      assert.equal(again.version, 2);
      assert.deepEqual(yield* listPages(userId, taskId), [again]);
      assert.equal(
        Option.getOrThrow(yield* readPageVersion(teammate, taskId, first.id, 1)).html,
        CHART.html,
      );
    }),
  );
});
