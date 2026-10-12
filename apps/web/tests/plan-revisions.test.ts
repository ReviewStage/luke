import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { EMPTY_PLAN_FIELDS, NOTE_KIND, planBody } from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  PLAN_FIELD,
  PLAN_HISTORY_BOUNDS,
  type PlanField,
  type PlanLastEdit,
  type PlanRevisionLine,
} from "@sidecar/hosted/plan-wire";
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { planRevision } from "../server/db/plan-revision-schema";
import { db } from "../server/db/query";
import { createCodingAgent } from "../server/hosted/coding-agent-store";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  restoreRevision,
  saveDeveloperEdit,
  saveNotes,
} from "../server/hosted/plan-notes";
import { listRevisions, PLAN_REVISION, type PlanWriter } from "../server/hosted/plan-revisions";
import { deletePlan, readPlan, savePlanDocument } from "../server/hosted/plan-store";
import { added, INVITATIONS_DRAFT, notesFor, SMALL_FEATURE } from "./support/plan-contents";
import { testSqlClient } from "./support/sql-client";
import { startPlan } from "./support/workspaces";

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
  const plan = yield* startPlan(userId, { name: "Teammate invitations" });
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

      assert.deepEqual(shapeOf(yield* revisionsOf(userId, planId)), [
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
        const joined = yield* revisionsOf(userId, planId);
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
          (yield* revisionsOf(userId, planId)).map(({ seq, changes }) => ({ seq, changes })),
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
          (yield* revisionsOf(userId, planId)).map(({ lastEdit }) => lastEdit.actor),
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

      assert.deepEqual(yield* revisionsOf(userId, planId), []);
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
            { fields: SMALL_FEATURE.fields },
          ),
        );
        yield* TestClock.adjust(Duration.hours(1));
        yield* saveNotes(
          { userId, planId },
          [added(PLAN_FIELD.APPROACH, "Invites expire.")],
          ON_CALL,
        );

        const revisions = yield* revisionsOf(userId, planId);
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
        (yield* revisionsOf(userId, planId)).map(({ seq, lastEdit }) => [seq, lastEdit.actor]),
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
          { fields: EMPTY_PLAN_FIELDS, agentEdits: [{ agentId, at: journaledAt, notes: [] }] },
        );

        assert.deepEqual(yield* lastEditOf(userId, planId), {
          actor: PLAN_ACTOR.AGENT,
          label: AGENT_MODEL,
          at: journaledAt,
          duringCall: false,
        });
      }),
  );

  it.effect(
    "each field names the save that last changed it: Luke on a call, a coding agent by its label, or the developer",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const start = yield* Clock.currentTimeMillis;
        yield* saveNotes(
          { userId, planId },
          [
            added(PLAN_FIELD.CONTEXT, "Only admins can invite."),
            added(PLAN_FIELD.APPROACH, "Invites expire."),
          ],
          ON_CALL,
        );
        yield* TestClock.adjust(Duration.minutes(3));
        const agentId = yield* startAgent(userId, planId);
        yield* saveNotes(
          { userId, planId },
          [added(PLAN_FIELD.APPROACH, "Links are single use.")],
          {
            actor: PLAN_ACTOR.AGENT,
            agentId,
          },
        );
        yield* TestClock.adjust(Duration.minutes(3));
        yield* saveDeveloperEdit(
          { userId, planId },
          { field: PLAN_FIELD.GOAL, base: null, value: "An invited teammate can sign in." },
        );

        const stored = Option.getOrThrow(yield* readPlan(userId, planId));
        const byField = new Map(stored.plan.fieldEdits?.map(({ field, ...edit }) => [field, edit]));
        assert.deepEqual(Object.fromEntries(byField), {
          [PLAN_FIELD.CONTEXT]: { actor: PLAN_ACTOR.NOTETAKER, at: start, duringCall: true },
          [PLAN_FIELD.APPROACH]: {
            actor: PLAN_ACTOR.AGENT,
            label: AGENT_MODEL,
            at: start + Duration.toMillis(Duration.minutes(3)),
            duringCall: false,
          },
          [PLAN_FIELD.GOAL]: {
            actor: PLAN_ACTOR.DEVELOPER,
            at: start + Duration.toMillis(Duration.minutes(6)),
            duringCall: false,
          },
        });
      }),
  );

  it.effect("another account reads no history of a plan it does not own", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const intruder = yield* openPlan;
      yield* saveNotes({ userId, planId }, notesFor(SMALL_FEATURE), ON_CALL);

      assert.deepEqual(yield* revisionsOf(intruder.userId, planId), []);
      assert.equal((yield* revisionsOf(userId, planId)).length, 1);
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
  /** Notes on the call, each a revision of its own: the saves stand further apart than any join. */
  const apart = (
    userId: string,
    planId: string,
    notes: readonly (readonly [PlanField, string])[],
  ) =>
    Effect.forEach(
      notes,
      ([field, text]) =>
        Effect.andThen(
          saveNotes({ userId, planId }, [added(field, text)], ON_CALL),
          TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1)),
        ),
      { discard: true },
    );

  const contentOf = (userId: string, planId: string) =>
    Effect.map(readPlan(userId, planId), (stored) => {
      const { fields, plan } = Option.getOrThrow(stored);
      return { fields, assumptions: plan.document.assumptions };
    });

  it.effect(
    "restoring a revision puts its content back as a new revision of the developer's, counted by the fields it changes",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        yield* apart(userId, planId, [[PLAN_FIELD.CONTEXT, "Only admins can invite."]]);
        const first = yield* contentOf(userId, planId);
        yield* apart(userId, planId, [
          [PLAN_FIELD.GOAL, "Members invite by email."],
          [PLAN_FIELD.APPROACH, "Invites expire."],
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

  it.effect("a restore joins no revision before it, and no save after it joins the restore", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* apart(userId, planId, [
        [PLAN_FIELD.CONTEXT, "Only admins can invite."],
        [PLAN_FIELD.GOAL, "Members invite by email."],
      ]);

      yield* restoreRevision({ userId, planId }, 1);
      yield* restoreRevision({ userId, planId }, 2);
      yield* saveNotes(
        { userId, planId },
        [added(PLAN_FIELD.APPROACH, "Invites expire.")],
        ON_CALL,
      );

      assert.deepEqual(
        (yield* revisionsOf(userId, planId)).map(({ seq, lastEdit, restoredFrom }) => [
          seq,
          lastEdit.actor,
          restoredFrom?.seq,
        ]),
        [
          [5, PLAN_ACTOR.NOTETAKER, undefined],
          [4, PLAN_ACTOR.DEVELOPER, 2],
          [3, PLAN_ACTOR.DEVELOPER, 1],
          [2, PLAN_ACTOR.NOTETAKER, undefined],
          [1, PLAN_ACTOR.NOTETAKER, undefined],
        ],
      );
    }),
  );

  it.effect("restoring the revision the plan already holds records nothing", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      yield* apart(userId, planId, [
        [PLAN_FIELD.CONTEXT, "Only admins can invite."],
        [PLAN_FIELD.GOAL, "Members invite by email."],
      ]);

      const restored = yield* restoreRevision({ userId, planId }, 2);

      assert.equal(restored.status, PLAN_SAVE_STATUS.SAVED);
      assert.deepEqual(
        (yield* revisionsOf(userId, planId)).map(({ seq }) => seq),
        [2, 1],
      );
    }),
  );

  it.effect("another account restores no revision of a plan it does not own", () =>
    Effect.gen(function* () {
      const { userId, planId } = yield* openPlan;
      const intruder = yield* openPlan;
      yield* apart(userId, planId, [
        [PLAN_FIELD.CONTEXT, "Only admins can invite."],
        [PLAN_FIELD.GOAL, "Members invite by email."],
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

  it.effect(
    "the history reads a page at a time, the page before naming where it is read from",
    () =>
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const saves = PLAN_HISTORY_BOUNDS.PAGE + 1;
        yield* apart(
          userId,
          planId,
          Array.from(
            { length: saves },
            (_, at) => [PLAN_FIELD.APPROACH, `Decision ${at + 1}.`] as const,
          ),
        );

        const newest = yield* listRevisions(userId, planId);
        const older = yield* listRevisions(userId, planId, newest.earlier);

        assert.equal(newest.revisions.length, PLAN_HISTORY_BOUNDS.PAGE);
        assert.equal(newest.revisions[0]?.seq, saves);
        assert.equal(newest.earlier, 2);
        assert.deepEqual(
          older.revisions.map(({ seq }) => seq),
          [1],
        );
        assert.equal(older.earlier, undefined);
      }),
  );
});
