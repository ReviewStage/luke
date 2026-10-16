import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { PlanSummary } from "@luke/features/plan-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { planPin } from "../../schemas/plan-pin.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { createPlan, deletePlan, listPlans, readPlan, updatePlan } from "../plan-store.js";

/**
 * A plan's pin is its reader's own: two members of one workspace read the
 * plan they share, and each reads only the pin they made, through the
 * store's public reads, over a real dialect. A pin made again keeps its first
 * instant, an archive leaves it standing, and it goes with its plan and its
 * account.
 *
 * Synthetic accounts, workspaces, and plans throughout.
 */

const SHARED_PLAN = { name: "Teammate invitations" };

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** Dean's workspace with Charles a member of it, and a plan Dean started there. */
const openSharedPlan = Effect.gen(function* () {
  const dean = yield* openAccount;
  const charles = yield* openAccount;
  const workspace = yield* openWorkspace(dean);
  yield* joinWorkspace(workspace, charles);
  const { id: planId } = yield* createPlan(dean, { ...SHARED_PLAN, organizationId: workspace });
  return { dean, charles, planId };
});

/** The plan's line in the account's list, archived ones among the rest, failing the test where it has none. */
const listedPlan = (userId: string, planId: string) =>
  Effect.map(
    listPlans(userId, { includeArchived: true }),
    (plans): PlanSummary =>
      plans.find(({ id }) => id === planId) ?? assert.fail("the plan is not in the list"),
  );

/** The plan's pin as the account reads it, in the list and opened alike, which must agree. */
const pinReadBy = (userId: string, planId: string) =>
  Effect.gen(function* () {
    const listed = (yield* listedPlan(userId, planId)).pinnedAt;
    const opened = yield* readPlan(userId, planId);
    assert.equal(Option.isSome(opened), true);
    assert.equal(Option.getOrUndefined(opened)?.plan.pinnedAt, listed);
    return listed;
  });

const pinnedOnes = (planId: string) =>
  Database.use((db) =>
    db.select({ userId: planPin.userId }).from(planPin).where(eq(planPin.planId, planId)),
  );

it.layer(getTestDB())("a plan's pin", (it) => {
  it.effect("a member's pin of a shared plan reads pinned for them alone", () =>
    Effect.gen(function* () {
      const { dean, charles, planId } = yield* openSharedPlan;
      const pinnedAt = yield* Clock.currentTimeMillis;

      const answered = yield* updatePlan(dean, planId, { pinned: true });

      assert.equal(Option.getOrUndefined(answered)?.pinnedAt, pinnedAt);
      assert.equal(yield* pinReadBy(dean, planId), pinnedAt);
      assert.equal(yield* pinReadBy(charles, planId), undefined);
      const renamed = yield* updatePlan(charles, planId, { name: "Invitations" });
      assert.equal(Option.getOrUndefined(renamed)?.pinnedAt, undefined);
    }),
  );

  it.effect("unpinning takes away only the account's own pin", () =>
    Effect.gen(function* () {
      const { dean, charles, planId } = yield* openSharedPlan;
      yield* updatePlan(dean, planId, { pinned: true });
      yield* TestClock.adjust("1 minute");
      const charlesPinnedAt = yield* Clock.currentTimeMillis;
      yield* updatePlan(charles, planId, { pinned: true });

      const answered = yield* updatePlan(dean, planId, { pinned: false });

      assert.equal(Option.getOrUndefined(answered)?.pinnedAt, undefined);
      assert.equal(yield* pinReadBy(dean, planId), undefined);
      assert.equal(yield* pinReadBy(charles, planId), charlesPinnedAt);
    }),
  );

  it.effect(
    "a plan pinned again keeps its first instant, and an archive and its return leave the pin standing",
    () =>
      Effect.gen(function* () {
        const { dean, planId } = yield* openSharedPlan;
        const pinnedAt = yield* Clock.currentTimeMillis;
        yield* updatePlan(dean, planId, { pinned: true });
        yield* TestClock.adjust("1 minute");

        yield* updatePlan(dean, planId, { pinned: true });
        assert.equal(yield* pinReadBy(dean, planId), pinnedAt);
        yield* updatePlan(dean, planId, { archived: true });
        assert.equal(yield* pinReadBy(dean, planId), pinnedAt);
        yield* updatePlan(dean, planId, { archived: false });
        assert.equal(yield* pinReadBy(dean, planId), pinnedAt);
      }),
  );

  it.effect("an account outside the workspace can neither pin the plan nor read a pin of it", () =>
    Effect.gen(function* () {
      const { dean, charles, planId } = yield* openSharedPlan;
      const outsider = yield* openAccount;
      yield* updatePlan(dean, planId, { pinned: true });

      assert.equal(Option.isNone(yield* updatePlan(outsider, planId, { pinned: true })), true);
      assert.equal(Option.isNone(yield* updatePlan(outsider, planId, { pinned: false })), true);
      assert.equal(Option.isNone(yield* readPlan(outsider, planId)), true);
      assert.deepEqual(yield* listPlans(outsider, { includeArchived: true }), []);
      assert.notEqual(yield* pinReadBy(dean, planId), undefined);
      assert.equal(yield* pinReadBy(charles, planId), undefined);
    }),
  );

  it.effect("a plan's pins go with the plan, and an account's with the account", () =>
    Effect.gen(function* () {
      const { dean, charles, planId } = yield* openSharedPlan;
      yield* updatePlan(dean, planId, { pinned: true });
      yield* updatePlan(charles, planId, { pinned: true });

      yield* Database.use((db) => db.delete(user).where(eq(user.id, charles)));
      assert.deepEqual(yield* pinnedOnes(planId), [{ userId: dean }]);
      assert.equal(yield* deletePlan(dean, planId), true);
      assert.deepEqual(yield* pinnedOnes(planId), []);
    }),
  );
});

it.layer(getTestDB())("a plan's starting name", (it) => {
  it.effect("a plan started with no name, or a blank one, stands as Untitled", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const organizationId = yield* openWorkspace(owner);
      const unnamed = yield* createPlan(owner, { organizationId });
      const blank = yield* createPlan(owner, { organizationId, name: "   " });
      const named = yield* createPlan(owner, { organizationId, name: "  Rate limits  " });

      assert.deepEqual(
        [unnamed.name, blank.name, named.name],
        ["Untitled", "Untitled", "Rate limits"],
      );
      assert.equal(
        Option.getOrUndefined(yield* readPlan(owner, unnamed.id))?.plan.name,
        "Untitled",
      );
    }),
  );
});
