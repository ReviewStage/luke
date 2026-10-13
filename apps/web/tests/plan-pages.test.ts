import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { listPages, readPageVersion, writePage } from "@sidecar/database/models/plan-pages";
import { createPlan } from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { Effect, Option } from "effect";

/**
 * A plan's pages, through the store's write and reads: a write is a page's
 * next version and every version stands as written, the plan lists each page
 * by its newest, and a plan another account owns, or a page the plan does
 * not hold, reads and writes as none. Synthetic accounts, plans, and pages
 * throughout.
 */

const CHART = { title: "Invite funnel", html: "<!doctype html><p>v1</p>" } as const;
const MOCKUP = { title: "Invite dialog", html: "<!doctype html><button>Invite</button>" } as const;

const openAccount = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

const openPlan = Effect.gen(function* () {
  const userId = yield* openAccount;
  const plan = yield* createPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: plan.id };
});

/** A write the test expects to land, as the page it left. */
const written = (userId: string, planId: string, write: Parameters<typeof writePage>[2]) =>
  Effect.map(writePage(userId, planId, write), Option.getOrThrow);

it.layer(getTestDB())("a plan's pages", (it) => {
  it.effect("another account's plan lists, reads, and takes no page", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const other = yield* openAccount;
      const chart = yield* written(userId, planId, CHART);

      assert.deepEqual(yield* listPages(other, planId), []);
      assert.ok(Option.isNone(yield* readPageVersion(other, planId, chart.id, 1)));
      assert.ok(Option.isNone(yield* writePage(other, planId, MOCKUP)));
      assert.ok(Option.isNone(yield* writePage(other, planId, { pageId: chart.id, ...MOCKUP })));
      assert.deepEqual(yield* listPages(userId, planId), [chart]);
    }),
  );
});
