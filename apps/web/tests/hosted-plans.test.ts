import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { PlanCreateRequest, PlanDocument } from "@sidecar/hosted";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { conversations } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { deleteAccount } from "../server/hosted/account-store";
import {
  attachPlanConversation,
  createPlan,
  deletePlan,
  listPlans,
  openPlan,
  readPlan,
} from "../server/hosted/plan-store";
import {
  type PlanToolBinding,
  runUpdatePlan,
  UPDATE_PLAN_REFUSAL,
  UPDATE_PLAN_STATUS,
  type UpdatePlanResult,
} from "../server/hosted/update-plan-tool";
import { noDatabase } from "./support/no-database";
import { testSqlClient } from "./support/sql-client";

/**
 * The named plans and their one document, through the store's public
 * functions and the `update_plan` tool, against a real dialect. What the
 * window reads (`openPlan`) and what the planning model resumes from
 * (`readPlan`) must both show exactly what the tool last saved, and nothing
 * a caller supplies can move a save onto another account's plan or bring a
 * deleted plan back.
 *
 * Synthetic accounts and repositories throughout.
 */

const COMMIT = {
  RELAY: "4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345",
  LEDGER: "0123456789abcdef0123456789abcdef01234567",
} as const;

const RELAY_PLAN: PlanCreateRequest = {
  name: "Teammate invitations",
  repository: { owner: "acme", name: "relay", branch: "main", commit: COMMIT.RELAY },
};

const LEDGER_PLAN: PlanCreateRequest = {
  name: "Billing export",
  repository: { owner: "acme", name: "ledger", branch: "trunk", commit: COMMIT.LEDGER },
};

const INVITATIONS: PlanDocument = {
  body: "# Teammate invitations\n\n## Goal\nA member invites a teammate by email.\n",
  assumptions: [
    { text: "Invites reuse `memberships` with a `pending` state.", confirmed: true },
    { text: "Only admins can invite teammates.", confirmed: false },
  ],
};

const EMPTY_DOCUMENT: PlanDocument = { body: "", assumptions: [] };

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

const openConversation = (userId: string) =>
  Effect.map(
    db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.MAIN })
      .returning({ id: conversations.id }),
    (rows) => rows[0]?.id ?? assert.fail("the conversation insert returned no row"),
  );

/** One tool call as the model would make it: its arguments are whatever JSON it emitted. */
const updatePlan = (binding: PlanToolBinding, input: WireBoundaryInput) =>
  runUpdatePlan(binding, unparsedWire(input));

/** The document a saved result carries, failing the test on any other outcome. */
function savedDocument(result: UpdatePlanResult): PlanDocument {
  if (result.status !== UPDATE_PLAN_STATUS.SAVED) {
    return assert.fail(`expected a save, got: ${result.reason}`);
  }
  return result.document;
}

/** The document the model resumes from, failing the test where the plan does not read. */
const resumedDocument = (userId: string, planId: string) =>
  Effect.map(readPlan(userId, planId), (stored) =>
    Option.match(stored, {
      onNone: () => assert.fail("the plan did not read"),
      onSome: (found) => found.plan.document,
    }),
  );

it.layer(testSqlClient)("named plans and the update_plan tool", (it) => {
  it.effect("a started plan has its repository context and an empty document", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const started = yield* createPlan(userId, RELAY_PLAN);

      assert.equal(started.name, RELAY_PLAN.name);
      assert.deepEqual(started.repository, RELAY_PLAN.repository);
      assert.deepEqual(started.document, EMPTY_DOCUMENT);
      assert.deepEqual(yield* resumedDocument(userId, started.id), EMPTY_DOCUMENT);
    }),
  );

  it.effect("two named plans keep independent documents and repository context", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const relay = yield* createPlan(userId, RELAY_PLAN);
      const ledger = yield* createPlan(userId, LEDGER_PLAN);
      const ledgerDocument: PlanDocument = {
        body: "# Billing export\n",
        assumptions: [{ text: "Exports are CSV.", confirmed: false }],
      };

      yield* updatePlan({ userId, planId: relay.id }, INVITATIONS);
      yield* updatePlan({ userId, planId: ledger.id }, ledgerDocument);

      const openedRelay = yield* openPlan(userId, relay.id);
      const openedLedger = yield* openPlan(userId, ledger.id);
      assert.deepEqual(
        Option.map(openedRelay, (found) => [found.repository, found.document]),
        Option.some([RELAY_PLAN.repository, INVITATIONS]),
      );
      assert.deepEqual(
        Option.map(openedLedger, (found) => [found.repository, found.document]),
        Option.some([LEDGER_PLAN.repository, ledgerDocument]),
      );
    }),
  );

  it.effect("a tool save answers the saved document, and the window and the model read it", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const started = yield* createPlan(userId, RELAY_PLAN);

      const result = yield* updatePlan({ userId, planId: started.id }, INVITATIONS);

      assert.deepEqual(savedDocument(result), INVITATIONS);
      const opened = yield* openPlan(userId, started.id);
      assert.deepEqual(
        Option.map(opened, (found) => found.document),
        Option.some(INVITATIONS),
      );
      assert.deepEqual(yield* resumedDocument(userId, started.id), INVITATIONS);
    }),
  );

  it.effect("the same tool rewrites assumption text and flips confirmation flags", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* createPlan(userId, RELAY_PLAN);
      yield* updatePlan({ userId, planId }, INVITATIONS);
      const corrected: PlanDocument = {
        body: INVITATIONS.body,
        assumptions: [
          { text: "Invites reuse `memberships` with a `pending` state.", confirmed: true },
          { text: "Members and admins can both invite.", confirmed: true },
          { text: "An invite expires after 7 days.", confirmed: false },
        ],
      };

      yield* updatePlan({ userId, planId }, corrected);

      assert.deepEqual(yield* resumedDocument(userId, planId), corrected);
    }),
  );

  it.effect("the list holds only the account's plans, the most recently opened first", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const other = yield* openUser;
      const relay = yield* createPlan(userId, RELAY_PLAN);
      yield* TestClock.adjust("1 minute");
      const ledger = yield* createPlan(userId, LEDGER_PLAN);
      yield* createPlan(other, RELAY_PLAN);

      const beforeOpening = yield* listPlans(userId);
      yield* TestClock.adjust("1 minute");
      yield* openPlan(userId, relay.id);
      const afterOpening = yield* listPlans(userId);

      assert.deepEqual(
        beforeOpening.map((summary) => summary.id),
        [ledger.id, relay.id],
      );
      assert.deepEqual(
        afterOpening.map((summary) => summary.id),
        [relay.id, ledger.id],
      );
    }),
  );

  it.effect("the model's read does not reorder the window's list", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const relay = yield* createPlan(userId, RELAY_PLAN);
      yield* TestClock.adjust("1 minute");
      const ledger = yield* createPlan(userId, LEDGER_PLAN);
      yield* TestClock.adjust("1 minute");

      yield* readPlan(userId, relay.id);

      const listed = yield* listPlans(userId);
      assert.deepEqual(
        listed.map((summary) => summary.id),
        [ledger.id, relay.id],
      );
    }),
  );

  it.effect("a second account cannot read, open, update, or delete another's plan", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const intruder = yield* openUser;
      const { id: planId } = yield* createPlan(owner, RELAY_PLAN);
      yield* updatePlan({ userId: owner, planId }, INVITATIONS);

      const saved = yield* updatePlan({ userId: intruder, planId }, EMPTY_DOCUMENT);

      assert.deepEqual(saved, {
        status: UPDATE_PLAN_STATUS.NOT_SAVED,
        reason: UPDATE_PLAN_REFUSAL.NO_PLAN,
      });
      assert.equal(Option.isNone(yield* readPlan(intruder, planId)), true);
      assert.equal(Option.isNone(yield* openPlan(intruder, planId)), true);
      assert.equal(yield* deletePlan(intruder, planId), false);
      assert.deepEqual(yield* listPlans(intruder), []);
      assert.deepEqual(yield* resumedDocument(owner, planId), INVITATIONS);
    }),
  );

  it.effect("a call that names an account or a plan is refused and writes nothing", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const victim = yield* openUser;
      const { id: ownPlan } = yield* createPlan(owner, RELAY_PLAN);
      const { id: victimPlan } = yield* createPlan(victim, LEDGER_PLAN);

      const result = yield* updatePlan(
        { userId: owner, planId: ownPlan },
        { ...INVITATIONS, userId: victim, planId: victimPlan },
      );

      assert.equal(result.status, UPDATE_PLAN_STATUS.NOT_SAVED);
      assert.deepEqual(yield* resumedDocument(owner, ownPlan), EMPTY_DOCUMENT);
      assert.deepEqual(yield* resumedDocument(victim, victimPlan), EMPTY_DOCUMENT);
    }),
  );

  it.effect("a malformed call is reported with its field and leaves the saved document", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* createPlan(userId, RELAY_PLAN);
      yield* updatePlan({ userId, planId }, INVITATIONS);

      const result = yield* updatePlan(
        { userId, planId },
        { body: "# Rewritten\n", assumptions: [{ text: "Unflagged." }] },
      );

      assert.deepEqual(result, {
        status: UPDATE_PLAN_STATUS.NOT_SAVED,
        reason: UPDATE_PLAN_REFUSAL.UNREADABLE,
        field: "assumptions.0.confirmed",
      });
      assert.deepEqual(yield* resumedDocument(userId, planId), INVITATIONS);
    }),
  );

  it.effect("a save the store refuses is reported as not saved and the prior document stands", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* createPlan(userId, RELAY_PLAN);
      yield* updatePlan({ userId, planId }, INVITATIONS);

      const result = yield* updatePlan({ userId, planId }, EMPTY_DOCUMENT).pipe(
        Effect.provide(noDatabase),
      );

      assert.deepEqual(result, {
        status: UPDATE_PLAN_STATUS.NOT_SAVED,
        reason: UPDATE_PLAN_REFUSAL.UNAVAILABLE,
      });
      assert.deepEqual(yield* resumedDocument(userId, planId), INVITATIONS);
    }),
  );

  it.effect("a deleted plan stays deleted: the tool answers it gone and recreates nothing", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* createPlan(userId, RELAY_PLAN);
      yield* updatePlan({ userId, planId }, INVITATIONS);

      assert.equal(yield* deletePlan(userId, planId), true);
      const result = yield* updatePlan({ userId, planId }, INVITATIONS);

      assert.deepEqual(result, {
        status: UPDATE_PLAN_STATUS.NOT_SAVED,
        reason: UPDATE_PLAN_REFUSAL.NO_PLAN,
      });
      assert.equal(Option.isNone(yield* readPlan(userId, planId)), true);
      assert.deepEqual(yield* listPlans(userId), []);
    }),
  );

  it.effect("the model resumes in the conversation attached to the plan", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* createPlan(userId, RELAY_PLAN);
      const conversationId = yield* openConversation(userId);

      const unattached = yield* readPlan(userId, planId);
      const attached = yield* attachPlanConversation(userId, planId, conversationId);
      const resumed = yield* readPlan(userId, planId);

      assert.deepEqual(
        Option.map(unattached, (stored) => stored.conversationId),
        Option.some(undefined),
      );
      assert.equal(attached, true);
      assert.deepEqual(
        Option.map(resumed, (stored) => stored.conversationId),
        Option.some(conversationId),
      );
    }),
  );

  it.effect(
    "a plan takes no other account's conversation, and no one attaches to another's plan",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const { id: planId } = yield* createPlan(owner, RELAY_PLAN);
        const othersConversation = yield* openConversation(other);
        const ownConversation = yield* openConversation(owner);

        assert.equal(yield* attachPlanConversation(owner, planId, othersConversation), false);
        assert.equal(yield* attachPlanConversation(other, planId, othersConversation), false);
        assert.equal(yield* attachPlanConversation(other, planId, ownConversation), false);
        assert.deepEqual(
          Option.map(yield* readPlan(owner, planId), (stored) => stored.conversationId),
          Option.some(undefined),
        );
      }),
  );

  it.effect("deleting the account deletes its plans", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* createPlan(userId, RELAY_PLAN);

      yield* deleteAccount(userId);

      assert.equal(Option.isNone(yield* readPlan(userId, planId)), true);
    }),
  );
});
