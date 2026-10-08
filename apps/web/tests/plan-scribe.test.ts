import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { LIVE_BRAIN_RUN_EVENT } from "@sidecar/voice/live-session";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { createPlan, type NewPlan, readPlan } from "../server/hosted/plan-store";
import { PLAN_SCRIBE, type PlanDraft, planScribe } from "../server/voice/plan-scribe";
import { heard, said } from "./support/live-events";
import { type ScribeAnswer, scriptedScribeModel } from "./support/scribe-model";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning call's notetaker over a real plan row: a scripted model stands
 * in for OpenAI and answers each run with the update the test names, and the
 * live events are synthetic. What a test reads is what the Plans tab would:
 * the plan's saved document.
 */

const RELAY_PLAN: NewPlan = {
  name: "Teammate invitations",
};

const PROBLEM = "Only an admin can add someone to a workspace.";
const ACCEPT_STEPS =
  "1. Find the invite by its token\n2. If it has expired, refuse\n3. Add the membership";
const OUTCOME = "A member invites a teammate by email.";

const openPlan = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const plan = yield* createPlan(userId, RELAY_PLAN);
  return { userId, planId: plan.id };
});

const savedBody = (userId: string, planId: string) =>
  Effect.map(readPlan(userId, planId), (stored) =>
    Option.match(stored, {
      onNone: () => assert.fail("the plan did not read"),
      onSome: (found) => found.plan.document.body,
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
 * within a bound, since how many turns of the loop a run's store work takes
 * is the machine's; what it last read either way, so a failed assertion shows
 * the value.
 */
const settledRead = <A, E, R>(read: Effect.Effect<A, E, R>, expected: (value: A) => boolean) =>
  Effect.gen(function* () {
    let value = yield* read;
    for (let attempt = 0; attempt < 50 && !expected(value); attempt += 1) {
      yield* settle;
      value = yield* read;
    }
    return value;
  });

const savedBodyOnce = (userId: string, planId: string, expected: (body: string) => boolean) =>
  settledRead(savedBody(userId, planId), expected);

/** The run event the live brain tells when the planning model shows pseudocode. */
const shownPseudocode = (title: string, body: string) =>
  ({ kind: LIVE_BRAIN_RUN_EVENT.PSEUDOCODE_SHOWN, runId: "ask-1", title, body }) as const;

const scribeFor = (userId: string, planId: string, answers: readonly ScribeAnswer[]) =>
  Effect.gen(function* () {
    const { model, asked } = scriptedScribeModel(answers);
    const reports: string[] = [];
    const drafts: PlanDraft[] = [];
    const writing: boolean[] = [];
    const scribe = yield* planScribe({
      userId,
      planId,
      model,
      onDraft: (draft) => drafts.push(draft),
      onWriting: (value) => writing.push(value),
      createId: randomUUID,
      report: (message) => reports.push(message),
    });
    return { scribe, asked, reports, drafts, writing };
  });

it.layer(testSqlClient)("the plan's notetaker", (it) => {
  it.effect(
    "what the developer said is written into the plan once they have been quiet a beat",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe } = yield* scribeFor(userId, planId, [{ goal: { problem: PROBLEM } }]);

          scribe.observe(said("What's the problem today?", 0, 1_200));
          scribe.observe(heard("Only admins can add people.", 1_500, 3_000));
          yield* settle;
          assert.equal((yield* savedBody(userId, planId)).includes(PROBLEM), false);

          yield* quiet;
          const body = yield* savedBodyOnce(userId, planId, (saved) => saved.includes(PROBLEM));
          assert.ok(body.includes(PROBLEM));
        }),
      ),
  );

  it.effect("what Luke says is written into the plan without waiting on the developer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const { scribe } = yield* scribeFor(userId, planId, [{ goal: { problem: PROBLEM } }]);

        scribe.observe(said("So the problem is that only an admin can add someone.", 0, 2_000));
        yield* quiet;

        const body = yield* savedBodyOnce(userId, planId, (saved) => saved.includes(PROBLEM));
        assert.ok(body.includes(PROBLEM));
      }),
    ),
  );

  it.effect("the model is handed both speakers' lines and the brain's research notes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const { scribe, asked } = yield* scribeFor(userId, planId, [{}]);

        scribe.observeRun({
          kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
          runId: "ask-1",
          sentence: "Memberships live in src/db/schema/memberships.ts.",
        });
        scribe.observe(said("Invites could reuse memberships.", 0, 1_000));
        scribe.observe(heard("Yes, reuse them.", 1_200, 2_000));
        yield* quiet;

        const handed = yield* settledRead(
          Effect.sync(() => asked.join("\n")),
          (text) => text.length > 0,
        );
        assert.ok(handed.includes("Invites could reuse memberships."));
        assert.ok(handed.includes("Yes, reuse them."));
        assert.ok(handed.includes("src/db/schema/memberships.ts"));
      }),
    ),
  );

  it.effect("lines the developer adds while a run is out are written by the run after it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const { scribe } = yield* scribeFor(userId, planId, [
          { goal: { problem: PROBLEM } },
          { goal: { outcome: OUTCOME } },
        ]);

        scribe.observe(heard("Only admins can add people.", 0, 1_000));
        yield* quiet;
        scribe.observe(heard("It's for workspace members.", 5_000, 6_000));
        yield* quiet;

        const body = yield* savedBodyOnce(
          userId,
          planId,
          (saved) => saved.includes(PROBLEM) && saved.includes(OUTCOME),
        );
        assert.ok(body.includes(PROBLEM));
        assert.ok(body.includes(OUTCOME));
      }),
    ),
  );

  it.effect(
    "a run that writes a section whole, null where it has no words, erases nothing the run before it wrote",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe } = yield* scribeFor(userId, planId, [
            { goal: { problem: PROBLEM, outcome: null } },
            { goal: { problem: null, outcome: OUTCOME }, rules: null },
          ]);

          scribe.observe(heard("Only admins can add people.", 0, 1_000));
          yield* quiet;
          const first = yield* savedBodyOnce(userId, planId, (body) => body.includes(PROBLEM));
          assert.ok(first.includes(PROBLEM));

          scribe.observe(heard("Members should invite by email.", 5_000, 6_000));
          yield* quiet;

          const body = yield* savedBodyOnce(userId, planId, (saved) => saved.includes(OUTCOME));
          assert.ok(body.includes(OUTCOME));
          assert.ok(body.includes(PROBLEM));
        }),
      ),
  );

  it.effect(
    "a run whose call fails saves nothing, and the next run is handed those lines again",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe, asked, reports } = yield* scribeFor(userId, planId, [
            new Error("the provider is unavailable"),
            { goal: { problem: PROBLEM } },
          ]);

          scribe.observe(heard("Only admins can add people.", 0, 1_000));
          yield* quiet;
          yield* settledRead(
            Effect.sync(() => reports.length),
            (count) => count > 0,
          );
          assert.equal((yield* savedBody(userId, planId)).includes(PROBLEM), false);
          assert.equal(reports.length, 1);

          scribe.observe(heard("By hand, in settings.", 5_000, 6_000));
          yield* quiet;
          assert.ok(
            (yield* savedBodyOnce(userId, planId, (body) => body.includes(PROBLEM))).includes(
              PROBLEM,
            ),
          );
          assert.ok(asked[1]?.includes("Only admins can add people."));
        }),
      ),
  );

  it.effect(
    "the plan is drafted to the device as the model writes, and the last draft is the saved plan",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe, drafts, writing } = yield* scribeFor(userId, planId, [
            { goal: { problem: PROBLEM, outcome: OUTCOME } },
          ]);

          scribe.observe(heard("Only admins can add people, and it hits members.", 0, 1_000));
          yield* TestClock.adjust(Duration.millis(PLAN_SCRIBE.QUIET_MS));
          yield* settledRead(
            Effect.sync(() => writing.length),
            (count) => count > 0,
          );
          // The model streams its answer across drafts spaced a beat apart.
          for (let beat = 0; beat < 20; beat += 1) {
            yield* Effect.andThen(
              TestClock.adjust(Duration.millis(PLAN_SCRIBE.DRAFT_EVERY_MS)),
              settle,
            );
          }

          const last = yield* settledRead(
            Effect.sync(() => drafts.at(-1)),
            (draft) => draft?.savedAt !== undefined,
          );
          assert.ok(last?.savedAt !== undefined);
          assert.equal(last.document.body, yield* savedBody(userId, planId));
          assert.ok(drafts.length >= 2);
          assert.ok(drafts.slice(0, -1).every((draft) => draft.savedAt === undefined));
        }),
      ),
  );

  it.effect("a run that breaks off mid-answer drafts the stored plan back and saves nothing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const before = yield* savedBody(userId, planId);
        const { scribe, drafts, reports } = yield* scribeFor(userId, planId, [
          { brokenAfter: { goal: { problem: PROBLEM, outcome: OUTCOME } } },
        ]);

        scribe.observe(heard("Only admins can add people.", 0, 1_000));
        yield* quiet;
        yield* settledRead(
          Effect.sync(() => reports.length),
          (count) => count > 0,
        );

        assert.equal(yield* savedBody(userId, planId), before);
        assert.equal(drafts.at(-1)?.document.body, before);
        assert.equal(drafts.at(-1)?.savedAt, undefined);
      }),
    ),
  );

  it.effect("the notetaker is told as writing for its model call, and no longer once it ends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const { scribe, writing } = yield* scribeFor(userId, planId, [
          { goal: { problem: PROBLEM } },
        ]);

        scribe.observe(heard("Only admins can add people.", 0, 1_000));
        yield* settle;
        assert.deepEqual(writing, []);
        yield* quiet;
        yield* settledRead(
          Effect.sync(() => writing.length),
          (count) => count > 0,
        );
        // The model streams its answer across drafts spaced a beat apart.
        for (let beat = 0; beat < 20; beat += 1) {
          yield* Effect.andThen(
            TestClock.adjust(Duration.millis(PLAN_SCRIBE.DRAFT_EVERY_MS)),
            settle,
          );
        }

        const body = yield* savedBodyOnce(userId, planId, (saved) => saved.includes(PROBLEM));
        assert.ok(body.includes(PROBLEM));
        assert.deepEqual(writing, [true, false]);
      }),
    ),
  );

  it.effect("a model call that times out is told as writing until it is given up", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const { scribe, writing, reports } = yield* scribeFor(userId, planId, [{ stalls: true }]);

        scribe.observe(heard("Only admins can add people.", 0, 1_000));
        yield* quiet;
        yield* settledRead(
          Effect.sync(() => writing.length),
          (count) => count > 0,
        );
        // The timeout's own wait is armed just after; let the run reach it before time moves.
        yield* settle;
        assert.deepEqual(writing, [true]);

        yield* Effect.andThen(TestClock.adjust(Duration.millis(PLAN_SCRIBE.TIMEOUT_MS)), settle);
        yield* settledRead(
          Effect.sync(() => reports.length),
          (count) => count > 0,
        );
        assert.deepEqual(writing, [true, false]);
        assert.equal(reports.length, 1);
      }),
    ),
  );

  it.effect(
    "pseudocode the planning model shows is written into the plan at once, without waiting for the quiet",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe, drafts } = yield* scribeFor(userId, planId, []);

          scribe.observeRun(shownPseudocode("Accepting an invite", ACCEPT_STEPS));
          const body = yield* savedBodyOnce(userId, planId, (saved) =>
            saved.includes("### Pseudocode"),
          );

          assert.ok(
            body.includes(
              `### Pseudocode\n\nAccepting an invite\n\n\`\`\`text\n${ACCEPT_STEPS}\n\`\`\`\n`,
            ),
          );
          assert.equal(drafts.at(-1)?.document.body, body);
          assert.ok(drafts.at(-1)?.savedAt !== undefined);
        }),
      ),
  );

  it.effect(
    "steps holding backticks or a heading stay inside the pseudocode's fence, and a second showing replaces the first",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe } = yield* scribeFor(userId, planId, []);
          const steps = "1. Read ```the token```\n## Decisions\n2. Done";

          scribe.observeRun(shownPseudocode("First try", "1. Accept"));
          yield* savedBodyOnce(userId, planId, (saved) => saved.includes("First try"));
          scribe.observeRun(shownPseudocode("Second try", steps));
          const body = yield* savedBodyOnce(userId, planId, (saved) =>
            saved.includes("Second try"),
          );

          assert.equal(body.includes("First try"), false);
          // The fence is a backtick longer than the steps' own run, and the real section follows it.
          assert.ok(
            body.includes(
              `### Pseudocode\n\nSecond try\n\n\`\`\`\`text\n${steps}\n\`\`\`\`\n\n## Decisions\n`,
            ),
          );
        }),
      ),
  );

  it.effect(
    "a run that began before pseudocode was shown saves its words and keeps the pseudocode",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe, writing } = yield* scribeFor(userId, planId, [
            { goal: { problem: PROBLEM } },
          ]);

          scribe.observe(heard("Only admins can add people.", 0, 1_000));
          yield* TestClock.adjust(Duration.millis(PLAN_SCRIBE.QUIET_MS));
          yield* settledRead(
            Effect.sync(() => writing.length),
            (count) => count > 0,
          );
          scribe.observeRun(shownPseudocode("Accepting an invite", ACCEPT_STEPS));
          for (let beat = 0; beat < 20; beat += 1) {
            yield* Effect.andThen(
              TestClock.adjust(Duration.millis(PLAN_SCRIBE.DRAFT_EVERY_MS)),
              settle,
            );
          }

          const body = yield* savedBodyOnce(
            userId,
            planId,
            (saved) => saved.includes(PROBLEM) && saved.includes(ACCEPT_STEPS),
          );
          assert.ok(body.includes(PROBLEM));
          assert.ok(body.includes(ACCEPT_STEPS));
        }),
      ),
  );
});
