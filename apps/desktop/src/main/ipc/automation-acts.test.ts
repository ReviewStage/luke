import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AUTOMATION_CALL_FAILURE } from "@sidecar/hosted/automation-view";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { automationActRows } from "./automation-acts";

/**
 * The Automations page's acts: only a panel asks, the voice and call windows
 * are refused in each kind's own words before the host is asked, and a
 * panel's ask reaches the host with its payload as the panel sent it.
 */

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const AUTOMATION_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";

function fixture() {
  const asked: string[] = [];
  const unanswered = (name: string) => () =>
    Effect.sync(() => {
      asked.push(name);
      return { failure: AUTOMATION_CALL_FAILURE.UNANSWERED };
    });
  const rows = automationActRows({
    host: {
      automationsList: unanswered("list"),
      automationsCreate: unanswered("create"),
      automationsChange: unanswered("change"),
      automationsDelete: unanswered("delete"),
      automationsRun: unanswered("run"),
      automationsRuns: unanswered("runs"),
      automationsWebhookSecret: unanswered("rotate"),
    },
  });
  // SAFETY: the router dispatches on the kind alone; the rows under test are the only ones reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked };
}

it.effect(
  "the voice and call windows are refused every automation act in the kind's own words, and the host is not asked",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      for (const sender of [VOICE, CALL]) {
        assert.deepEqual(
          yield* router.performAct({ kind: ACT_KIND.AUTOMATIONS_LIST, payload: {} }, sender),
          { status: ACT_OUTCOME_STATUS.REFUSED, reason: ACT[ACT_KIND.AUTOMATIONS_LIST].refusal },
        );
        for (const kind of [ACT_KIND.AUTOMATIONS_DELETE, ACT_KIND.AUTOMATIONS_RUNS]) {
          assert.deepEqual(
            yield* router.performAct({ kind, payload: { automationId: AUTOMATION_ID } }, sender),
            { status: ACT_OUTCOME_STATUS.REFUSED, reason: ACT[kind].refusal },
          );
        }
      }
      assert.deepEqual(asked, []);
    }),
);

it.effect("a panel's ask reaches the host", () =>
  Effect.gen(function* () {
    const { router, asked } = fixture();

    const outcome = yield* router.performAct(
      { kind: ACT_KIND.AUTOMATIONS_RUNS, payload: { automationId: AUTOMATION_ID } },
      PANEL,
    );

    assert.equal(outcome.status, ACT_OUTCOME_STATUS.DONE);
    assert.deepEqual(asked, ["runs"]);
  }),
);
