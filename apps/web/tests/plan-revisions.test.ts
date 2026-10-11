import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { EMPTY_PLAN_FIELDS, NOTE_KIND, PLAN_FIELD, planBody } from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, type PlanLastEdit } from "@sidecar/hosted/plan-wire";
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { planRevision } from "../server/db/plan-revision-schema";
import { db } from "../server/db/query";
import { createCodingAgent } from "../server/hosted/coding-agent-store";
import { saveNotes } from "../server/hosted/plan-notes";
import {
  listRevisions,
  PLAN_REVISION,
  type PlanRevisionLine,
  type PlanWriter,
} from "../server/hosted/plan-revisions";
import { createPlan, deletePlan, readPlan, savePlanDocument } from "../server/hosted/plan-store";
import { added, INVITATIONS_DRAFT, notesFor, SMALL_FEATURE } from "./support/plan-contents";
import { testSqlClient } from "./support/sql-client";

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

const openPlan = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const plan = yield* createPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: plan.id };
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

const lastEditOf = (userId: string, planId: string) =>
  Effect.map(
    readPlan(userId, planId),
    (stored): PlanLastEdit | undefined => Option.getOrThrow(stored).plan.lastEdit,
  );

it.layer(testSqlClient)("a plan's history", (it) => {
  it.effect("every save that changes the plan is a revision under the writer who made it", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* saveNotes({ userId, planId }, notesFor(INVITATIONS_DRAFT), ON_CALL);
      const agentId = yield* startAgent(userId, planId);
      yield* saveNotes(
        { userId, planId },
        [added(PLAN_FIELD.OPEN_QUESTIONS, "Who may withdraw an invite?")],
        { actor: PLAN_ACTOR.AGENT, agentId },
      );

      assert.deepEqual(shapeOf(yield* listRevisions(userId, planId)), [
        { seq: 2, actor: PLAN_ACTOR.AGENT, label: AGENT_MODEL, duringCall: false, changes: 1 },
        {
          seq: 1,
          actor: PLAN_ACTOR.NOTETAKER,
          label: undefined,
          duringCall: true,
          changes: notesFor(INVITATIONS_DRAFT).length,
        },
      ]);
    }),
  );

  it.effect(
    "the same writer's saves a few minutes apart are one revision, and later ones another",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        yield* saveNotes(
          { userId, planId },
          [added(PLAN_FIELD.CONTEXT, "Only admins can invite.")],
          ON_CALL,
        );
        yield* TestClock.adjust(Duration.minutes(5));
        yield* saveNotes(
          { userId, planId },
          [added(PLAN_FIELD.GOAL, "Members invite by email.")],
          ON_CALL,
        );
        const joined = yield* listRevisions(userId, planId);
        yield* TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1));
        yield* saveNotes(
          { userId, planId },
          [added(PLAN_FIELD.APPROACH, "Invites expire.")],
          ON_CALL,
        );

        assert.deepEqual(
          joined.map(({ seq, changes, startedAt, lastEdit }) => ({
            seq,
            changes,
            lasted: lastEdit.at - startedAt,
          })),
          [{ seq: 1, changes: 2, lasted: Duration.toMillis(Duration.minutes(5)) }],
        );
        assert.deepEqual(
          (yield* listRevisions(userId, planId)).map(({ seq, changes }) => ({ seq, changes })),
          [
            { seq: 2, changes: 1 },
            { seq: 1, changes: 2 },
          ],
        );
      }),
  );

  it.effect(
    "a save by another writer between two of one writer's starts a revision of its own",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const agentId = yield* startAgent(userId, planId);
        yield* saveNotes(
          { userId, planId },
          [added(PLAN_FIELD.CONTEXT, "Only admins can invite.")],
          ON_CALL,
        );
        yield* saveNotes({ userId, planId }, [added(PLAN_FIELD.APPROACH, "Invites expire.")], {
          actor: PLAN_ACTOR.AGENT,
          agentId,
        });
        yield* saveNotes(
          { userId, planId },
          [added(PLAN_FIELD.GOAL, "Members invite by email.")],
          ON_CALL,
        );

        assert.deepEqual(
          (yield* listRevisions(userId, planId)).map(({ lastEdit }) => lastEdit.actor),
          [PLAN_ACTOR.NOTETAKER, PLAN_ACTOR.AGENT, PLAN_ACTOR.NOTETAKER],
        );
      }),
  );

  it.effect("notes that change nothing are no revision", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* saveNotes(
        { userId, planId },
        [
          {
            kind: NOTE_KIND.REPLACE,
            field: PLAN_FIELD.CONTEXT,
            find: "a phrase it never held",
            text: "anything",
          },
        ],
        ON_CALL,
      );

      assert.deepEqual(yield* listRevisions(userId, planId), []);
      assert.equal(yield* lastEditOf(userId, planId), undefined);
    }),
  );

  it.effect("a correction that takes a field to the words it already held is no revision", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* saveNotes(
        { userId, planId },
        [added(PLAN_FIELD.CONTEXT, "- Only admins invite.")],
        ON_CALL,
      );
      const written = yield* listRevisions(userId, planId);
      yield* TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1));
      yield* saveNotes(
        { userId, planId },
        [
          {
            kind: NOTE_KIND.REPLACE,
            field: PLAN_FIELD.CONTEXT,
            find: "Only admins invite.",
            text: "Only admins invite.",
          },
        ],
        ON_CALL,
      );

      assert.deepEqual(yield* listRevisions(userId, planId), written);
    }),
  );

  it.effect(
    "a plan written before its history began keeps what it held as its first revision, at its last save",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        yield* TestClock.adjust(Duration.hours(1));
        const before = Option.getOrThrow(
          yield* savePlanDocument(
            userId,
            planId,
            {
              body: planBody({ name: "Teammate invitations" }, SMALL_FEATURE.fields),
              assumptions: SMALL_FEATURE.assumptions,
            },
            SMALL_FEATURE.fields,
          ),
        );
        yield* TestClock.adjust(Duration.hours(1));
        yield* saveNotes(
          { userId, planId },
          [added(PLAN_FIELD.APPROACH, "Invites expire.")],
          ON_CALL,
        );

        const revisions = yield* listRevisions(userId, planId);
        assert.deepEqual(
          revisions.map(({ seq, lastEdit, changes }) => ({ seq, actor: lastEdit.actor, changes })),
          [
            { seq: 2, actor: PLAN_ACTOR.NOTETAKER, changes: 1 },
            { seq: 1, actor: PLAN_ACTOR.EARLIER, changes: 0 },
          ],
        );
        assert.equal(revisions[1]?.lastEdit.at, before.updatedAt);
      }),
  );

  it.effect("a plan's first save after it started is its first revision, with none before it", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* saveNotes({ userId, planId }, notesFor(SMALL_FEATURE), ON_CALL);

      assert.deepEqual(
        (yield* listRevisions(userId, planId)).map(({ seq, lastEdit }) => [seq, lastEdit.actor]),
        [[1, PLAN_ACTOR.NOTETAKER]],
      );
    }),
  );

  it.effect(
    "a plan's last edit is its newest revision: who wrote it, when, and whether on a call",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const start = yield* Clock.currentTimeMillis;
        yield* TestClock.adjust(Duration.minutes(3));
        yield* saveNotes(
          { userId, planId },
          [added(PLAN_FIELD.CONTEXT, "Only admins can invite.")],
          ON_CALL,
        );
        const byLuke = yield* lastEditOf(userId, planId);
        yield* TestClock.adjust(Duration.minutes(3));
        const agentId = yield* startAgent(userId, planId);
        yield* saveNotes({ userId, planId }, [added(PLAN_FIELD.APPROACH, "Invites expire.")], {
          actor: PLAN_ACTOR.AGENT,
          agentId,
        });

        assert.deepEqual(byLuke, {
          actor: PLAN_ACTOR.NOTETAKER,
          at: start + Duration.toMillis(Duration.minutes(3)),
          duringCall: true,
        });
        assert.deepEqual(yield* lastEditOf(userId, planId), {
          actor: PLAN_ACTOR.AGENT,
          label: AGENT_MODEL,
          at: start + Duration.toMillis(Duration.minutes(6)),
          duringCall: false,
        });
      }),
  );

  it.effect(
    "before a plan's history begins, its last edit is the newest save a coding agent journaled",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const agentId = yield* startAgent(userId, planId);
        const journaledAt =
          (yield* Clock.currentTimeMillis) + Duration.toMillis(Duration.minutes(2));
        yield* TestClock.adjust(Duration.minutes(2));
        yield* savePlanDocument(
          userId,
          planId,
          { body: planBody({ name: "Teammate invitations" }, EMPTY_PLAN_FIELDS), assumptions: [] },
          EMPTY_PLAN_FIELDS,
          [{ agentId, at: journaledAt, notes: [] }],
        );

        assert.deepEqual(yield* lastEditOf(userId, planId), {
          actor: PLAN_ACTOR.AGENT,
          label: AGENT_MODEL,
          at: journaledAt,
          duringCall: false,
        });
      }),
  );

  it.effect("another account reads no history of a plan it does not own", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const intruder = yield* openPlan;
      yield* saveNotes({ userId, planId }, notesFor(SMALL_FEATURE), ON_CALL);

      assert.deepEqual(yield* listRevisions(intruder.userId, planId), []);
      assert.equal((yield* listRevisions(userId, planId)).length, 1);
    }),
  );

  // Note that this reads the table itself, because a deleted plan's history
  // is read by nothing, and what it held must be gone rather than unreachable.
  it.effect("deleting a plan deletes its history", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* saveNotes({ userId, planId }, notesFor(SMALL_FEATURE), ON_CALL);
      assert.ok(yield* deletePlan(userId, planId));

      const left = yield* db
        .select({ seq: planRevision.seq })
        .from(planRevision)
        .where(eq(planRevision.planId, planId));
      assert.deepEqual(left, []);
    }),
  );
});
