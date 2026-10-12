import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { NOTE_KIND, PLAN_HEADING } from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, PLAN_FIELD, PLAN_FIELD_BOUNDS } from "@sidecar/hosted/plan-wire";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  type PlanEditSaveResult,
  saveDeveloperEdit,
  saveNotes,
} from "../server/hosted/plan-notes";
import { listRevisions } from "../server/hosted/plan-revisions";
import { readPlan } from "../server/hosted/plan-store";
import { added } from "./support/plan-contents";
import { testSqlClient } from "./support/sql-client";
import { startPlan } from "./support/workspaces";

/**
 * The developer's own edit of one field, through the plan's one write: it
 * lands in the field, is kept as the developer's revision, merges over what
 * Luke wrote meanwhile where it still can, and is answered as a conflict
 * with nothing saved where it cannot. Synthetic accounts and plans throughout.
 */

const LUKES = "- Only an admin can add a member.\n- Admins are a bottleneck.";
const CALL = { actor: PLAN_ACTOR.NOTETAKER, liveSessionId: "rtc-session-edits" } as const;

const openPlan = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const plan = yield* startPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: plan.id };
});

/** A plan whose problem holds what Luke wrote on a call. */
const openWrittenPlan = Effect.gen(function* () {
  const opened = yield* openPlan;
  yield* saveNotes(opened, [added(PLAN_FIELD.PROBLEM, LUKES)], CALL);
  return opened;
});

const storedOf = (userId: string, planId: string) =>
  Effect.map(readPlan(userId, planId), Option.getOrThrow);

/** The saved plan an edit answered, failing the test on any other outcome. */
function savedPlan(result: PlanEditSaveResult) {
  if (result.status !== PLAN_SAVE_STATUS.SAVED)
    return assert.fail(`expected a save: ${result.status}`);
  return result.plan;
}

it.layer(testSqlClient)("the developer's edits", (it) => {
  it.effect(
    "an edit lands in its field, formatted into the body, and the plan says the developer wrote it",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openWrittenPlan;
        const value = "- Only an admin can add a member, by hand.";

        const plan = savedPlan(
          yield* saveDeveloperEdit(
            { userId, planId },
            { field: PLAN_FIELD.PROBLEM, base: LUKES, value },
          ),
        );

        assert.equal(plan.fields?.goal.problem, value);
        assert.ok(plan.document.body.includes(`### ${PLAN_HEADING.PROBLEM}\n\n${value}`));
        assert.equal(plan.lastEdit?.actor, PLAN_ACTOR.DEVELOPER);
        assert.equal(plan.lastEdit?.duringCall, false);
        assert.deepEqual((yield* storedOf(userId, planId)).plan.document, plan.document);
        assert.deepEqual(
          (yield* listRevisions(userId, planId)).revisions.map(({ lastEdit }) => lastEdit.actor),
          [PLAN_ACTOR.DEVELOPER, PLAN_ACTOR.NOTETAKER],
        );
      }),
  );

  it.effect(
    "a point Luke added while the developer typed survives their edit, and theirs survives his",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openWrittenPlan;
        yield* saveNotes(
          { userId, planId },
          [added(PLAN_FIELD.PROBLEM, "- Invites go missing in spam.")],
          CALL,
        );

        const plan = savedPlan(
          yield* saveDeveloperEdit(
            { userId, planId },
            {
              field: PLAN_FIELD.PROBLEM,
              base: LUKES,
              value: "- Only an owner can add a member.\n- Admins are a bottleneck.",
            },
          ),
        );

        assert.equal(
          plan.fields?.goal.problem,
          "- Only an owner can add a member.\n- Admins are a bottleneck.\n- Invites go missing in spam.",
        );
      }),
  );

  it.effect(
    "an edit of a line Luke rewrote meanwhile conflicts with what the field holds, and saves nothing",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openWrittenPlan;
        yield* saveNotes(
          { userId, planId },
          [
            {
              kind: NOTE_KIND.REPLACE,
              field: PLAN_FIELD.PROBLEM,
              find: "an admin",
              text: "an owner",
            },
          ],
          CALL,
        );
        const before = yield* storedOf(userId, planId);

        const result = yield* saveDeveloperEdit(
          { userId, planId },
          { field: PLAN_FIELD.PROBLEM, base: LUKES, value: "- Only a member can add a member." },
        );

        assert.deepEqual(result, {
          status: PLAN_SAVE_STATUS.CONFLICT,
          current: "- Only an owner can add a member.\n- Admins are a bottleneck.",
        });
        assert.deepEqual((yield* storedOf(userId, planId)).plan, before.plan);
      }),
  );

  it.effect(
    "a correction Luke takes later, aimed at words the developer rewrote, is passed over and theirs stand",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openWrittenPlan;
        const mine = "- Only an owner can add a member.\n- Admins are a bottleneck.";
        yield* saveDeveloperEdit(
          { userId, planId },
          { field: PLAN_FIELD.PROBLEM, base: LUKES, value: mine },
        );

        const noted = yield* saveNotes(
          { userId, planId },
          [
            {
              kind: NOTE_KIND.REPLACE,
              field: PLAN_FIELD.PROBLEM,
              find: "an admin",
              text: "a manager",
            },
          ],
          CALL,
        );

        assert.equal(noted.status, PLAN_SAVE_STATUS.SAVED);
        assert.equal((yield* storedOf(userId, planId)).fields.goal.problem, mine);
      }),
  );

  it.effect(
    "an edit of the rules and of the assumptions saves each list whole, as the developer's",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const rule = { statement: "Any member may invite by email.", examples: null };

        savedPlan(
          yield* saveDeveloperEdit(
            { userId, planId },
            { field: PLAN_FIELD.RULES, base: null, value: [rule] },
          ),
        );
        const plan = savedPlan(
          yield* saveDeveloperEdit(
            { userId, planId },
            {
              field: PLAN_FIELD.ASSUMPTIONS,
              base: [],
              value: [{ text: "Invites reuse memberships." }],
            },
          ),
        );

        assert.deepEqual(plan.fields?.rules, [rule]);
        assert.ok(plan.document.body.includes("### Rule 1: Any member may invite by email."));
        assert.deepEqual(plan.document.assumptions, [{ text: "Invites reuse memberships." }]);
        assert.equal(plan.lastEdit?.actor, PLAN_ACTOR.DEVELOPER);
      }),
  );

  it.effect("the developer's edits a few minutes apart are one revision of theirs", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* saveDeveloperEdit(
        { userId, planId },
        { field: PLAN_FIELD.DECISIONS, base: null, value: "Invites expire." },
      );
      yield* TestClock.adjust(Duration.minutes(2));
      yield* saveDeveloperEdit(
        { userId, planId },
        {
          field: PLAN_FIELD.DECISIONS,
          base: "Invites expire.",
          value: "Invites expire after 7 days.",
        },
      );

      assert.deepEqual(
        (yield* listRevisions(userId, planId)).revisions.map(({ lastEdit, changes }) => [
          lastEdit.actor,
          changes,
        ]),
        [[PLAN_ACTOR.DEVELOPER, 2]],
      );
    }),
  );

  it.effect(
    "an edit that would carry the plan past its bound is refused, and nothing is saved",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const before = yield* storedOf(userId, planId);

        const result = yield* saveDeveloperEdit(
          { userId, planId },
          {
            field: PLAN_FIELD.DECISIONS,
            base: null,
            value: "x".repeat(PLAN_FIELD_BOUNDS.MAX_ANSWER_CHARS),
          },
        );

        assert.deepEqual(result, {
          status: PLAN_SAVE_STATUS.NOT_SAVED,
          reason: PLAN_SAVE_REFUSAL.TOO_LONG,
        });
        assert.deepEqual((yield* storedOf(userId, planId)).plan, before.plan);
      }),
  );

  it.effect("another account's plan reads as no plan, and is not written", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openWrittenPlan;
      const intruder = yield* openPlan;
      const before = yield* storedOf(userId, planId);

      const result = yield* saveDeveloperEdit(
        { userId: intruder.userId, planId },
        { field: PLAN_FIELD.PROBLEM, base: LUKES, value: "- Taken over." },
      );

      assert.deepEqual(result, {
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.NO_PLAN,
      });
      assert.deepEqual((yield* storedOf(userId, planId)).plan, before.plan);
    }),
  );
});
