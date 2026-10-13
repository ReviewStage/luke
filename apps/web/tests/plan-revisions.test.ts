import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { createCodingAgent } from "@sidecar/database/models/coding-agent-store";
import {
  listRevisions,
  PLAN_REVISION,
  type PlanWriter,
  readRevision,
} from "@sidecar/database/models/plan-revisions";
import { readPlan } from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { PLAN_HEADING, type PlanNote } from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, type PlanRevisionLine } from "@sidecar/hosted/plan-wire";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  restoreRevision,
  saveNotes,
} from "../server/hosted/plan-notes";
import { added } from "./support/plan-contents";
import { joinWorkspace, startPlan } from "./support/workspaces";

/**
 * A plan's history, through the plan's one write and the store's reads:
 * every save that changes the plan is kept under its writer, the same
 * writer's saves in a row are one revision, a plan from before history keeps
 * what it held as its first revision, and the plan names its newest
 * revision's writer as its last edit. Synthetic accounts and plans throughout.
 */

const CALL = "rtc-session-history";
const AGENT_MODEL = "anthropic/claude-opus-5.5";
const ON_CALL: PlanWriter = { actor: PLAN_ACTOR.NOTETAKER, liveSessionId: CALL };

/** Notes that write a draft into a plan, each in a section of its own. */
const DRAFT_NOTES: readonly PlanNote[] = [
  added(PLAN_HEADING.CONTEXT, "A member cannot bring a teammate in without an admin."),
  added(PLAN_HEADING.HARD_PARTS, "- A withdrawn invite's link never grants access."),
  added(PLAN_HEADING.OPEN_QUESTIONS, "- Who can withdraw an invite?"),
];

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

const openPlan = Effect.gen(function* () {
  const userId = yield* openUser;
  const plan = yield* startPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: plan.id, workspaceId: plan.workspaceId };
});

const startAgent = (userId: string, planId: string) =>
  Effect.map(
    createCodingAgent(userId, {
      planId,
      idempotencyKey: randomUUID(),
      model: AGENT_MODEL,
      effort: "high",
      planSnapshot: "# Teammate invitations",
      task: null,
      repository: "acme/relay",
    }),
    (started) => Option.getOrThrow(started).agent.id,
  );

/** The newest page of the plan's history, which holds every revision a test here writes. */
const revisionsOf = (userId: string, planId: string) =>
  Effect.map(listRevisions(userId, planId), (page) => page.revisions);

/** Each revision as the history lists it, without the instants a test's clock decides. */
function shapeOf(revisions: readonly PlanRevisionLine[]) {
  return revisions.map(({ seq, lastEdit, changes }) => ({
    seq,
    actor: lastEdit.actor,
    label: lastEdit.label,
    duringCall: lastEdit.duringCall,
    changes,
  }));
}

it.layer(getTestDB())("a plan's history", (it) => {
  it.effect("every save that changes the plan is a revision under the writer who made it", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* saveNotes({ userId, planId }, DRAFT_NOTES, ON_CALL);
      const agentId = yield* startAgent(userId, planId);
      yield* saveNotes(
        { userId, planId },
        [added(PLAN_HEADING.OPEN_QUESTIONS, "- Who may withdraw an invite?")],
        { actor: PLAN_ACTOR.AGENT, agentId },
      );

      assert.deepEqual(shapeOf(yield* revisionsOf(userId, planId)), [
        { seq: 2, actor: PLAN_ACTOR.AGENT, label: AGENT_MODEL, duringCall: false, changes: 1 },
        {
          seq: 1,
          actor: PLAN_ACTOR.NOTETAKER,
          label: undefined,
          duringCall: true,
          changes: DRAFT_NOTES.length,
        },
      ]);
    }),
  );

  it.effect("a member of the plan's workspace reads the history a teammate wrote", () =>
    Effect.gen(function* () {
      const { userId, planId, workspaceId } = yield* openPlan;
      const teammate = yield* openUser;
      yield* joinWorkspace(workspaceId, teammate);
      yield* saveNotes({ userId, planId }, DRAFT_NOTES, ON_CALL);

      assert.equal((yield* revisionsOf(userId, planId)).length, 1);
      assert.deepEqual(yield* revisionsOf(teammate, planId), yield* revisionsOf(userId, planId));
      assert.equal(Option.isSome(yield* readRevision(teammate, planId, 1)), true);
      assert.deepEqual(
        yield* readRevision(teammate, planId, 1),
        yield* readRevision(userId, planId, 1),
      );
    }),
  );

  it.effect("another account reads no history of a plan it does not own", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const intruder = yield* openPlan;
      yield* saveNotes({ userId, planId }, DRAFT_NOTES, ON_CALL);

      assert.deepEqual(yield* revisionsOf(intruder.userId, planId), []);
      assert.equal((yield* revisionsOf(userId, planId)).length, 1);
    }),
  );
  /** Notes on the call, each a revision of its own: the saves stand further apart than any join. */
  const apart = (userId: string, planId: string, notes: readonly (readonly [string, string])[]) =>
    Effect.forEach(
      notes,
      ([heading, text]) =>
        Effect.andThen(
          saveNotes({ userId, planId }, [added(heading, text)], ON_CALL),
          TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1)),
        ),
      { discard: true },
    );

  const contentOf = (userId: string, planId: string) =>
    Effect.map(readPlan(userId, planId), (stored) => Option.getOrThrow(stored).text);

  it.effect(
    "restoring a revision puts its text back as a new revision of the developer's, counted by the sections it changes",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        yield* apart(userId, planId, [[PLAN_HEADING.CONTEXT, "Only admins can invite."]]);
        const first = yield* contentOf(userId, planId);
        yield* apart(userId, planId, [
          [PLAN_HEADING.GOAL, "Members invite by email."],
          [PLAN_HEADING.APPROACH, "Invites expire."],
        ]);

        const restored = yield* restoreRevision({ userId, planId }, 1);

        assert.equal(restored.status, PLAN_SAVE_STATUS.SAVED);
        assert.deepEqual(yield* contentOf(userId, planId), first);
        const [newest] = yield* revisionsOf(userId, planId);
        assert.deepEqual(
          { seq: newest?.seq, actor: newest?.lastEdit.actor, changes: newest?.changes },
          { seq: 4, actor: PLAN_ACTOR.DEVELOPER, changes: 2 },
        );
        assert.equal(newest?.restoredFrom?.seq, 1);
      }),
  );

  it.effect("another account restores no revision of a plan it does not own", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const intruder = yield* openPlan;
      yield* apart(userId, planId, [
        [PLAN_HEADING.CONTEXT, "Only admins can invite."],
        [PLAN_HEADING.GOAL, "Members invite by email."],
      ]);
      const before = yield* contentOf(userId, planId);

      assert.deepEqual(yield* restoreRevision({ userId: intruder.userId, planId }, 1), {
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.NO_REVISION,
      });
      assert.deepEqual(yield* contentOf(userId, planId), before);
      assert.equal((yield* revisionsOf(userId, planId)).length, 2);
    }),
  );
});
