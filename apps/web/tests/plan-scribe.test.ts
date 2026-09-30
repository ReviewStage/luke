import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { PlanUpdate } from "@sidecar/hosted/plan-template";
import { LIVE_BRAIN_RUN_EVENT } from "@sidecar/voice/live-session";
import { MockLanguageModelV4 } from "ai/test";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { createPlan, type NewPlan, readPlan } from "../server/hosted/plan-store";
import { PLAN_SCRIBE, planScribe } from "../server/voice/plan-scribe";
import { heard, said } from "./support/live-events";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning call's notetaker over a real plan row: a scripted model stands
 * in for OpenAI and answers each run with the update the test names, and the
 * live events are synthetic. What a test reads is what the Plans tab would:
 * the plan's saved document.
 */

const RELAY_PLAN: NewPlan = {
  name: "Teammate invitations",
  repository: {
    owner: "acme",
    name: "relay",
    branch: "main",
    commit: "4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345",
  },
};

const PROBLEM = "Only an admin can add someone to a workspace.";
const USERS = "Workspace members, and the teammates they invite.";

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** What the scripted model answers one run with: an update, or a failure of the call. */
type Answer = PlanUpdate | Error;

/** A model answering each call with the next scripted answer, and keeping what each call was handed. */
function scriptedModel(answers: readonly Answer[]) {
  const asked: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      asked.push(JSON.stringify(options.prompt));
      const answer = answers[asked.length - 1] ?? {};
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(answer) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: USAGE,
        warnings: [],
      };
    },
  });
  return { model, asked };
}

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
  times: 50,
});

/** The developer's quiet elapsing, and the run it starts left to finish. */
const quiet = Effect.andThen(TestClock.adjust(Duration.millis(PLAN_SCRIBE.QUIET_MS)), settle);

const scribeFor = (userId: string, planId: string, answers: readonly Answer[]) =>
  Effect.gen(function* () {
    const { model, asked } = scriptedModel(answers);
    const reports: string[] = [];
    const scribe = yield* planScribe({
      userId,
      planId,
      model,
      createId: randomUUID,
      report: (message) => reports.push(message),
    });
    return { scribe, asked, reports };
  });

it.layer(testSqlClient)("the plan's notetaker", (it) => {
  it.effect(
    "what the developer said is written into the plan once they have been quiet a beat",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe } = yield* scribeFor(userId, planId, [{ purpose: { problem: PROBLEM } }]);

          scribe.observe(said("What's the problem today?", 0, 1_200));
          scribe.observe(heard("Only admins can add people.", 1_500, 3_000));
          yield* settle;
          assert.equal((yield* savedBody(userId, planId)).includes(PROBLEM), false);

          yield* quiet;
          assert.ok((yield* savedBody(userId, planId)).includes(PROBLEM));
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

        const handed = asked.join("\n");
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
          { purpose: { problem: PROBLEM } },
          { purpose: { users: USERS } },
        ]);

        scribe.observe(heard("Only admins can add people.", 0, 1_000));
        yield* quiet;
        scribe.observe(heard("It's for workspace members.", 5_000, 6_000));
        yield* quiet;

        const body = yield* savedBody(userId, planId);
        assert.ok(body.includes(PROBLEM));
        assert.ok(body.includes(USERS));
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
            { purpose: { problem: PROBLEM } },
          ]);

          scribe.observe(heard("Only admins can add people.", 0, 1_000));
          yield* quiet;
          assert.equal((yield* savedBody(userId, planId)).includes(PROBLEM), false);
          assert.equal(reports.length, 1);

          scribe.observe(heard("By hand, in settings.", 5_000, 6_000));
          yield* quiet;
          assert.ok((yield* savedBody(userId, planId)).includes(PROBLEM));
          assert.ok(asked[1]?.includes("Only admins can add people."));
        }),
      ),
  );
});
