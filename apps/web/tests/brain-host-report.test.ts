import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { REPORT_KIND, type Report } from "@sidecar/hosted/rollout-wire";
import { Effect, Option, Result } from "effect";
import { ASK_ORIGIN } from "../server/core";
import { ASK_REFUSAL } from "../server/hosted/brain-ask";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { EVE_SEND_OUTCOME } from "../server/hosted/brain-host/eve-sessions";
import { reportToPlan } from "../server/hosted/brain-host/report";
import { createPlan, readPlan } from "../server/hosted/plan-store";
import { askRecord } from "../server/hosted/store/asks";
import { type FakeEve, fakeEve } from "./support/fake-eve";
import { openGithubUser } from "./support/github-app-fake";
import { testSqlClient } from "./support/sql-client";

/**
 * A rollout worker's report handed to Luke on the plan's conversation, over
 * the real migrations and a fake eve: the conversation opened for a plan
 * that has none, the report opening a session or following one up under the
 * report's own turn kind, a retired or never-ready session reopened, and
 * one report per key however often it is handed. Synthetic throughout.
 */

const OPENED: Report = {
  kind: REPORT_KIND.PR_OPENED,
  position: 3,
  pullRequest: 415,
  text: "The migration is in.",
};

const ASKED: Report = {
  kind: REPORT_KIND.QUESTION,
  position: 2,
  text: "Should the column be nullable?",
  options: ["Nullable", "Default to zero"],
};

/** The deployment acting for the account, as the fake eve writes its caller down. */
const DEPLOYMENT = "deployment";

/** A plan of a fresh account, its conversation not yet opened, and the seams a report goes through. */
const planOf = (eve: FakeEve = fakeEve()) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const plan = yield* createPlan(owner, { name: "Teammate invitations" });
    const asks = askRecord();
    const report = (report: Report, clientKey: string = randomUUID()) =>
      reportToPlan(
        { asks, eve: eve.eve(DEPLOYMENT) },
        { userId: owner, planId: plan.id, report, clientKey },
      );
    return { owner, plan, eve, asks, report };
  });

it.layer(testSqlClient)("a report to the plan", (it) => {
  it.effect(
    "a report on a plan with no conversation opens the plan's conversation and a session in it under the report's turn kind, its words the report's first line, its own words, and its options",
    () =>
      Effect.gen(function* () {
        const { owner, plan, eve, asks, report } = yield* planOf();

        const asked = yield* report(ASKED);

        assert.ok(Result.isSuccess(asked));
        const stored = yield* readPlan(owner, plan.id);
        assert.ok(Option.isSome(stored));
        assert.equal(stored.value.conversationId, asked.success.conversationId);
        assert.deepEqual(
          eve.opened.map((opened) => [opened.authorization, opened.message]),
          [
            [
              DEPLOYMENT,
              {
                conversationId: asked.success.conversationId,
                turn: BRAIN_HOST_TURN.REPORT,
                message:
                  "[worker 2] asks\n\nShould the column be nullable?\n\n- Nullable\n- Default to zero",
              },
            ],
          ],
        );
        const row = yield* asks.named(owner, asked.success.id);
        assert.equal(row?.origin, ASK_ORIGIN.REPORT);
        assert.equal(row?.sessionId, eve.opened[0]?.sessionId);
      }),
  );

  it.effect(
    "a later report follows up the session the plan's conversation runs in rather than opening another",
    () =>
      Effect.gen(function* () {
        const { eve, report } = yield* planOf();

        const first = yield* report(ASKED);
        const second = yield* report(OPENED);

        assert.ok(Result.isSuccess(first) && Result.isSuccess(second));
        assert.equal(second.success.conversationId, first.success.conversationId);
        assert.equal(eve.opened.length, 1);
        assert.deepEqual(
          eve.sent.map((sent) => [sent.sessionId, sent.message]),
          [
            [
              eve.opened[0]?.sessionId,
              {
                conversationId: first.success.conversationId,
                turn: BRAIN_HOST_TURN.REPORT,
                message: "[worker 3] opened #415\n\nThe migration is in.",
              },
            ],
          ],
        );
      }),
  );

  it.effect(
    "a report to a session eve retired, or whose inbox never came up, opens a new session with the report",
    () =>
      Effect.gen(function* () {
        const reopenedBy = (
          sends: typeof EVE_SEND_OUTCOME.RETIRED | typeof EVE_SEND_OUTCOME.NOT_READY,
        ) =>
          Effect.gen(function* () {
            const { eve, report } = yield* planOf(fakeEve({ sends }));
            yield* report(ASKED);
            const reopened = yield* report(OPENED);
            return { eve, reopened };
          });
        for (const sends of [EVE_SEND_OUTCOME.RETIRED, EVE_SEND_OUTCOME.NOT_READY] as const) {
          const { eve, reopened } = yield* reopenedBy(sends);

          assert.ok(Result.isSuccess(reopened));
          assert.equal(eve.sent.length, 1);
          assert.deepEqual(
            eve.opened.map((opened) => opened.message.message),
            [
              "[worker 2] asks\n\nShould the column be nullable?\n\n- Nullable\n- Default to zero",
              "[worker 3] opened #415\n\nThe migration is in.",
            ],
          );
        }
      }),
  );

  it.effect(
    "a report handed again under the same key is the report already taken, and eve is handed it once",
    () =>
      Effect.gen(function* () {
        const { eve, report } = yield* planOf();
        const key = randomUUID();

        const first = yield* report(OPENED, key);
        const again = yield* report(OPENED, key);

        assert.ok(Result.isSuccess(first) && Result.isSuccess(again));
        assert.equal(again.success.id, first.success.id);
        assert.equal(eve.opened.length, 1);
        assert.deepEqual(eve.sent, []);
      }),
  );

  it.effect(
    "a report on a plan the account does not own is not found, and eve is handed nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { plan } = yield* planOf(eve);
        const stranger = yield* openGithubUser();

        const refused = yield* reportToPlan(
          { asks: askRecord(), eve: eve.eve(DEPLOYMENT) },
          { userId: stranger, planId: plan.id, report: OPENED, clientKey: randomUUID() },
        );

        assert.deepEqual(refused, Result.fail({ refusal: ASK_REFUSAL.NOT_FOUND }));
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a report eve could not be reached for is refused, and the same key hands it to eve once eve is back",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const plan = yield* createPlan(owner, { name: "Teammate invitations" });
        const key = randomUUID();
        const handed = { userId: owner, planId: plan.id, report: OPENED, clientKey: key };
        const down = fakeEve({ reachable: false });
        const up = fakeEve();

        const refused = yield* reportToPlan(
          { asks: askRecord(), eve: down.eve(DEPLOYMENT) },
          handed,
        );
        const taken = yield* reportToPlan({ asks: askRecord(), eve: up.eve(DEPLOYMENT) }, handed);

        assert.ok(Result.isFailure(refused));
        assert.equal(refused.failure.refusal, ASK_REFUSAL.UPSTREAM);
        assert.ok(Result.isSuccess(taken));
        assert.equal(up.opened.length, 1);
      }),
  );
});
