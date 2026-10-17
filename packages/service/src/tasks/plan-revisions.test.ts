import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import {
  listRevisions,
  PLAN_REVISION,
  type PlanWriter,
} from "@luke/database/models/plan-revisions";
import { readTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, startTask } from "@luke/database/testing";
import { PLAN_HEADING, type PlanNote } from "@luke/features/plan-template";
import { PLAN_ACTOR, type PlanRevisionLine } from "@luke/features/task-wire";
import { eq } from "drizzle-orm";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { added } from "../testing/task-contents.js";
import { PLAN_SAVE_REFUSAL, PLAN_SAVE_STATUS, restoreRevision, saveNotes } from "./plan-notes.js";

/**
 * A plan's history, through the plan's one write and the store's reads:
 * every save that changes the plan is kept under its writer, the same
 * writer's saves in a row are one revision, a plan from before history keeps
 * what it held as its first revision, and the plan names its newest
 * revision's writer as its last edit. Synthetic accounts and tasks throughout.
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

const openNamedUser = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name, email: `${userId}@luke.test` });
    return userId;
  });

const openUser = openNamedUser("Test User");

/** The developer, as the writer of an edit the window sends. */
const DEVELOPER: PlanWriter = { actor: PLAN_ACTOR.DEVELOPER };

const openTask = Effect.gen(function* () {
  const userId = yield* openUser;
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  return { userId, taskId: task.id, workspaceId: task.workspaceId };
});

const startAgent = (userId: string, taskId: string) =>
  Effect.map(
    createCodingAgent(userId, {
      taskId,
      idempotencyKey: randomUUID(),
      model: AGENT_MODEL,
      effort: "high",
      planSnapshot: "# Teammate invitations",
      prompt: null,
      repository: "acme/relay",
    }),
    (started) => Option.getOrThrow(started).agent.id,
  );

/** The newest page of the plan's history, which holds every revision a test here writes. */
const revisionsOf = (userId: string, taskId: string) =>
  Effect.map(listRevisions(userId, taskId), (page) => page.revisions);

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
      const { userId, taskId } = yield* openTask;
      yield* saveNotes({ userId, taskId }, DRAFT_NOTES, ON_CALL);
      const agentId = yield* startAgent(userId, taskId);
      yield* saveNotes(
        { userId, taskId },
        [added(PLAN_HEADING.OPEN_QUESTIONS, "- Who may withdraw an invite?")],
        { actor: PLAN_ACTOR.AGENT, agentId },
      );

      assert.deepEqual(shapeOf(yield* revisionsOf(userId, taskId)), [
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
      const { userId, taskId, workspaceId } = yield* openTask;
      const teammate = yield* openUser;
      yield* joinWorkspace(workspaceId, teammate);
      yield* saveNotes({ userId, taskId }, DRAFT_NOTES, ON_CALL);

      assert.equal((yield* revisionsOf(userId, taskId)).length, 1);
      assert.deepEqual(yield* revisionsOf(teammate, taskId), yield* revisionsOf(userId, taskId));
    }),
  );

  it.effect("another account reads no history of a plan it does not own", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const intruder = yield* openTask;
      yield* saveNotes({ userId, taskId }, DRAFT_NOTES, ON_CALL);

      assert.deepEqual(yield* revisionsOf(intruder.userId, taskId), []);
      assert.equal((yield* revisionsOf(userId, taskId)).length, 1);
    }),
  );
  /** Notes on the call, each a revision of its own: the saves stand further apart than any join. */
  const apart = (userId: string, taskId: string, notes: readonly (readonly [string, string])[]) =>
    Effect.forEach(
      notes,
      ([heading, text]) =>
        Effect.andThen(
          saveNotes({ userId, taskId }, [added(heading, text)], ON_CALL),
          TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1)),
        ),
      { discard: true },
    );

  const contentOf = (userId: string, taskId: string) =>
    Effect.map(readTask(userId, taskId), (stored) => Option.getOrThrow(stored).text);

  it.effect(
    "restoring a revision puts its text back as a new revision of the developer's, counted by the sections it changes",
    () =>
      Effect.gen(function* () {
        const { userId, taskId } = yield* openTask;
        yield* apart(userId, taskId, [[PLAN_HEADING.CONTEXT, "Only admins can invite."]]);
        const first = yield* contentOf(userId, taskId);
        yield* apart(userId, taskId, [
          [PLAN_HEADING.GOAL, "Members invite by email."],
          [PLAN_HEADING.APPROACH, "Invites expire."],
        ]);

        const restored = yield* restoreRevision({ userId, taskId }, 1);

        assert.equal(restored.status, PLAN_SAVE_STATUS.SAVED);
        assert.deepEqual(yield* contentOf(userId, taskId), first);
        const [newest] = yield* revisionsOf(userId, taskId);
        assert.deepEqual(
          { seq: newest?.seq, actor: newest?.lastEdit.actor, changes: newest?.changes },
          { seq: 4, actor: PLAN_ACTOR.DEVELOPER, changes: 2 },
        );
        assert.equal(newest?.restoredFrom?.seq, 1);
      }),
  );

  it.effect("another account restores no revision of a plan it does not own", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      const intruder = yield* openTask;
      yield* apart(userId, taskId, [
        [PLAN_HEADING.CONTEXT, "Only admins can invite."],
        [PLAN_HEADING.GOAL, "Members invite by email."],
      ]);
      const before = yield* contentOf(userId, taskId);

      assert.deepEqual(yield* restoreRevision({ userId: intruder.userId, taskId }, 1), {
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.NO_REVISION,
      });
      assert.deepEqual(yield* contentOf(userId, taskId), before);
      assert.equal((yield* revisionsOf(userId, taskId)).length, 2);
    }),
  );
  it.effect(
    "two members' edits are each a revision under the member who made it, and each reads the other's by name",
    () =>
      Effect.gen(function* () {
        const dean = yield* openNamedUser("Dean Stratakos");
        const task = yield* startTask(dean, { name: "Teammate invitations" });
        const charles = yield* openNamedUser("Charles Pan");
        yield* joinWorkspace(task.workspaceId, charles);
        const taskId = task.id;
        yield* saveNotes(
          { userId: dean, taskId },
          [added(PLAN_HEADING.GOAL, "Members invite.")],
          DEVELOPER,
        );
        // Within the join's reach, which one member's saves in a row would share.
        yield* saveNotes(
          { userId: charles, taskId },
          [added(PLAN_HEADING.APPROACH, "Invites expire.")],
          DEVELOPER,
        );

        const DEAN = { userId: dean, name: "Dean Stratakos" };
        const CHARLES = { userId: charles, name: "Charles Pan" };
        for (const reader of [dean, charles]) {
          const lines = yield* revisionsOf(reader, taskId);
          assert.deepEqual(
            lines.map((line) => line.lastEdit.by),
            [CHARLES, DEAN],
          );
          const stored = Option.getOrThrow(yield* readTask(reader, taskId));
          assert.deepEqual(stored.task.lastEdit?.by, CHARLES);
          const bySection = new Map(
            stored.task.sectionEdits?.map((edit) => [edit.section, edit.by]),
          );
          assert.deepEqual(bySection.get(PLAN_HEADING.GOAL), DEAN);
          assert.deepEqual(bySection.get(PLAN_HEADING.APPROACH), CHARLES);
        }
      }),
  );

  it.effect("Luke's notes on a member's call are kept under that member", () =>
    Effect.gen(function* () {
      const { userId, taskId } = yield* openTask;
      yield* saveNotes({ userId, taskId }, DRAFT_NOTES, ON_CALL);

      const [line] = yield* revisionsOf(userId, taskId);
      assert.deepEqual(line?.lastEdit.by, { userId, name: "Test User" });
    }),
  );

  it.effect(
    "a coding agent's edit names the agent, on the plan's last edit and on the sections it changed, so the window can find it",
    () =>
      Effect.gen(function* () {
        const { userId, taskId } = yield* openTask;
        yield* saveNotes(
          { userId, taskId },
          [added(PLAN_HEADING.GOAL, "Members invite.")],
          DEVELOPER,
        );
        const agentId = yield* startAgent(userId, taskId);
        yield* saveNotes({ userId, taskId }, [added(PLAN_HEADING.APPROACH, "Invites expire.")], {
          actor: PLAN_ACTOR.AGENT,
          agentId,
        });

        const { task } = Option.getOrThrow(yield* readTask(userId, taskId));
        assert.equal(task.lastEdit?.agentId, agentId);
        const bySection = new Map(task.sectionEdits?.map((edit) => [edit.section, edit.agentId]));
        assert.equal(bySection.get(PLAN_HEADING.APPROACH), agentId);
        assert.equal(bySection.get(PLAN_HEADING.GOAL), undefined);
      }),
  );

  it.effect(
    "a coding agent's revision names no member, and a member whose account is gone is named by nobody",
    () =>
      Effect.gen(function* () {
        const { userId, taskId, workspaceId } = yield* openTask;
        const teammate = yield* openNamedUser("Ana Kowalski");
        yield* joinWorkspace(workspaceId, teammate);
        yield* saveNotes(
          { userId: teammate, taskId },
          [added(PLAN_HEADING.GOAL, "Members invite.")],
          DEVELOPER,
        );
        const agentId = yield* startAgent(userId, taskId);
        yield* saveNotes({ userId, taskId }, [added(PLAN_HEADING.APPROACH, "Invites expire.")], {
          actor: PLAN_ACTOR.AGENT,
          agentId,
        });
        const db = yield* Database;
        yield* db.delete(user).where(eq(user.id, teammate));

        const lines = yield* revisionsOf(userId, taskId);
        assert.deepEqual(
          lines.map((line) => [line.lastEdit.actor, line.lastEdit.by]),
          [
            [PLAN_ACTOR.AGENT, undefined],
            [PLAN_ACTOR.DEVELOPER, undefined],
          ],
        );
      }),
  );
});
