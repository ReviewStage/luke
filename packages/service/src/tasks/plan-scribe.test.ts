import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { readTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask, type TestTask } from "@luke/database/testing";
import { NOTE_KIND, PLAN_HEADING } from "@luke/features/plan-template";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { heard, said } from "../testing/live-events.js";
import { type ScribeAnswer, scriptedScribeModel } from "../testing/scribe-model.js";
import { added } from "../testing/task-contents.js";
import { PLAN_SCRIBE, type PlanDraft, planScribe } from "./plan-scribe.js";

/**
 * The task call's notetaker over a real task row: a scripted model stands
 * in for OpenAI and answers each run with the notes the test names, and the
 * live events are synthetic. What a test reads is what the Tasks tab would:
 * the plan's saved document.
 */

const RELAY_TASK: TestTask = {
  name: "Teammate invitations",
};

/** The call the scribe listens to, as the voice service names it. */
const CALL = "rtc-session-plan-scribe";

const PROBLEM = "Only an admin can add someone to a workspace.";
const OUTCOME = "A member invites a teammate by email.";

const openTask = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, RELAY_TASK);
  return { userId, taskId: task.id };
});

const savedBody = (userId: string, taskId: string) =>
  Effect.map(readTask(userId, taskId), (stored) =>
    Option.match(stored, {
      onNone: () => assert.fail("the plan did not read"),
      onSome: (found) => found.task.document.body,
    }),
  );

/** Lets the scribe's fiber run to its next wait, the store's and the model's promises included. */
const settle = Effect.repeat(Effect.andThen(Effect.yieldNow, TestClock.adjust(Duration.zero)), {
  times: 500,
});

/** The developer's quiet elapsing, and the run it starts left to finish. */
const quiet = Effect.andThen(TestClock.adjust(Duration.millis(PLAN_SCRIBE.QUIET_MS)), settle);

/**
 * What `read` answers once it reads as `expected`, settling again between reads
 * for as long as that takes. Note that no count of the loop's turns bounds the
 * wait, because a run's store work is answered by a real database on its own
 * time: a count of turns is a wall-clock budget the machine spends at its own
 * speed, and a loaded Postgres on CI outlasted it. The test's timeout is the bound.
 */
const settledRead = <A, E, R>(read: Effect.Effect<A, E, R>, expected: (value: A) => boolean) =>
  Effect.gen(function* () {
    let value = yield* read;
    while (!expected(value)) {
      yield* settle;
      value = yield* read;
    }
    return value;
  });

const savedBodyOnce = (userId: string, taskId: string, expected: (body: string) => boolean) =>
  settledRead(savedBody(userId, taskId), expected);

const scribeFor = (userId: string, taskId: string, answers: readonly ScribeAnswer[]) =>
  Effect.gen(function* () {
    const { model, asked, pace } = scriptedScribeModel(answers);
    const reports: string[] = [];
    const drafts: PlanDraft[] = [];
    const writing: boolean[] = [];
    const scribe = yield* planScribe({
      userId,
      taskId,
      liveSessionId: CALL,
      model,
      onDraft: (draft) => drafts.push(draft),
      onWriting: (value) => writing.push(value),
      createId: randomUUID,
      report: (message) => reports.push(message),
    });
    return { scribe, asked, pace, reports, drafts, writing };
  });

it.layer(getTestDB())("the plan's notetaker", (it) => {
  it.effect(
    "what the developer said is written into the plan once they have been quiet a beat",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, taskId } = yield* openTask;
          const { scribe } = yield* scribeFor(userId, taskId, [
            { notes: [added(PLAN_HEADING.CONTEXT, PROBLEM)] },
          ]);

          scribe.observe(said("What's the problem today?", 0, 1_200));
          scribe.observe(heard("Only admins can add people.", 1_500, 3_000));
          yield* settle;
          assert.equal((yield* savedBody(userId, taskId)).includes(PROBLEM), false);

          yield* quiet;
          const body = yield* savedBodyOnce(userId, taskId, (saved) => saved.includes(PROBLEM));
          assert.ok(body.includes(PROBLEM));
        }),
      ),
  );

  it.effect(
    "a run that corrects a phrase changes only that phrase, and what the run before wrote stands",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, taskId } = yield* openTask;
          const corrected = "Only an owner can add someone to a workspace.";
          const { scribe } = yield* scribeFor(userId, taskId, [
            { notes: [added(PLAN_HEADING.CONTEXT, PROBLEM)] },
            {
              notes: [
                {
                  kind: NOTE_KIND.REPLACE,
                  find: "an admin",
                  text: "an owner",
                },
                added(PLAN_HEADING.GOAL, OUTCOME),
              ],
            },
          ]);

          scribe.observe(heard("Only admins can add people.", 0, 1_000));
          yield* quiet;
          const first = yield* savedBodyOnce(userId, taskId, (body) => body.includes(PROBLEM));
          assert.ok(first.includes(PROBLEM));

          scribe.observe(heard("Sorry, owners, not admins. Members should invite.", 5_000, 6_000));
          yield* quiet;

          const body = yield* savedBodyOnce(userId, taskId, (saved) => saved.includes(OUTCOME));
          assert.ok(body.includes(OUTCOME));
          assert.ok(body.includes(`\n\n${corrected}\n\n## Goal`));
          assert.ok(!body.includes(PROBLEM));
        }),
      ),
  );

  it.effect(
    "an answer with one note naming text the plan does not hold saves none of its notes, and its lines are handed to the next run",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, taskId } = yield* openTask;
          const { scribe, asked, reports } = yield* scribeFor(userId, taskId, [
            {
              notes: [
                added(PLAN_HEADING.CONTEXT, PROBLEM),
                { kind: NOTE_KIND.REPLACE, find: "## Rollout", text: "" },
              ],
            },
            { notes: [added(PLAN_HEADING.GOAL, OUTCOME)] },
          ]);

          scribe.observe(heard("Only admins can add people.", 0, 1_000));
          yield* quiet;
          yield* settledRead(
            Effect.sync(() => reports.length),
            (count) => count > 0,
          );
          assert.equal((yield* savedBody(userId, taskId)).includes(PROBLEM), false);

          scribe.observe(heard("Members should invite.", 5_000, 6_000));
          yield* quiet;

          const body = yield* savedBodyOnce(userId, taskId, (saved) => saved.includes(OUTCOME));
          assert.equal(body.includes(PROBLEM), false);
          assert.ok(asked[1]?.includes("Only admins can add people."));
        }),
      ),
  );
});
