import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { listPages, readPageVersion, writePage } from "@sidecar/database/models/plan-pages";
import { deletePlan } from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { planPageVersion } from "@sidecar/database/schemas/plan-page";
import { getTestDB } from "@sidecar/database/testing";
import { PAGE_BOUNDS } from "@sidecar/hosted/page-wire";
import { eq } from "drizzle-orm";
import { Duration, Effect, Exit, Option } from "effect";
import { TestClock } from "effect/testing";
import { startPlan } from "./support/workspaces";

/**
 * A plan's pages, through the store's write and reads: a write is a page's
 * next version and every version stands as written, the plan lists each page
 * by its newest, and a plan another account owns, or a page the plan does
 * not hold, reads and writes as none. Synthetic accounts, plans, and pages
 * throughout.
 */

const CHART = { title: "Invite funnel", html: "<!doctype html><p>v1</p>" } as const;
const CHART_AGAIN = { title: "Invite funnel, by week", html: "<!doctype html><p>v2</p>" } as const;
const MOCKUP = { title: "Invite dialog", html: "<!doctype html><button>Invite</button>" } as const;

const openAccount = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

const openPlan = Effect.gen(function* () {
  const userId = yield* openAccount;
  const plan = yield* startPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: plan.id };
});

/** A write the test expects to land, as the page it left. */
const written = (userId: string, planId: string, write: Parameters<typeof writePage>[2]) =>
  Effect.map(writePage(userId, planId, write), Option.getOrThrow);

it.layer(getTestDB())("a plan's pages", (it) => {
  it.effect("writing a page again makes its next version, and every version reads as written", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const first = yield* written(userId, planId, CHART);
      yield* TestClock.adjust(Duration.minutes(1));
      const second = yield* written(userId, planId, { pageId: first.id, ...CHART_AGAIN });

      assert.deepEqual(second, { id: first.id, title: CHART_AGAIN.title, version: 2, at: 60_000 });
      assert.deepEqual(yield* listPages(userId, planId), [second]);
      assert.deepEqual(Option.getOrThrow(yield* readPageVersion(userId, planId, first.id, 1)), {
        id: first.id,
        title: CHART.title,
        version: 1,
        at: 0,
        html: CHART.html,
      });
      assert.equal(
        Option.getOrThrow(yield* readPageVersion(userId, planId, first.id, 2)).html,
        CHART_AGAIN.html,
      );
      assert.ok(Option.isNone(yield* readPageVersion(userId, planId, first.id, 3)));
    }),
  );

  it.effect("the plan lists each page once, the most recently written first", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const chart = yield* written(userId, planId, CHART);
      yield* TestClock.adjust(Duration.minutes(1));
      const mockup = yield* written(userId, planId, MOCKUP);
      yield* TestClock.adjust(Duration.minutes(1));
      const revised = yield* written(userId, planId, { pageId: chart.id, ...CHART_AGAIN });

      assert.deepEqual(yield* listPages(userId, planId), [revised, mockup]);
    }),
  );

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

  it.effect(
    "a page the plan does not hold takes no version, even one of the account's other plan",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const elsewhere = yield* startPlan(userId, { name: "Billing export" });
        const theirs = yield* written(userId, elsewhere.id, CHART);

        assert.ok(
          Option.isNone(yield* writePage(userId, planId, { pageId: theirs.id, ...MOCKUP })),
        );
        assert.ok(
          Option.isNone(yield* writePage(userId, planId, { pageId: randomUUID(), ...MOCKUP })),
        );
        assert.ok(Option.isNone(yield* readPageVersion(userId, planId, theirs.id, 1)));
        assert.deepEqual(yield* listPages(userId, planId), []);
      }),
  );

  it.effect(
    "a write past the bounds the desktop reads pages by is refused, and nothing is stored",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const refused = [
          { title: "", html: CHART.html },
          { title: "x".repeat(PAGE_BOUNDS.MAX_TITLE_CHARS + 1), html: CHART.html },
          { title: CHART.title, html: "" },
          { title: CHART.title, html: "x".repeat(PAGE_BOUNDS.MAX_HTML_CHARS + 1) },
        ];
        for (const write of refused) {
          assert.ok(Exit.isFailure(yield* Effect.exit(writePage(userId, planId, write))));
        }

        assert.deepEqual(yield* listPages(userId, planId), []);
      }),
  );

  it.effect("deleting the plan deletes its pages", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* written(userId, planId, CHART);

      assert.ok(yield* deletePlan(userId, planId));
      const left = yield* db
        .select({ id: planPageVersion.id })
        .from(planPageVersion)
        .where(eq(planPageVersion.planId, planId));
      assert.deepEqual(left, []);
    }),
  );
});
