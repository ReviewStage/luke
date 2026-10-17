import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AUTOMATION_CALL_FAILURE } from "@luke/features/automation-view";
import { Effect } from "effect";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "../acts.js";
import { type AutomationActsDependencies, automationActRows } from "./automation-acts.js";
import { type ActRows, type ActSender, createActRouter } from "./router.js";

/**
 * The Automations pages' acts: only a panel asks, the voice and call windows
 * are refused in each kind's own words before the host is asked, and a
 * panel's ask reaches the host with its payload as the panel sent it.
 */

// The platform's handle on the window that asked, which no row here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const AUTOMATION_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";

type HostAsk = AutomationActsDependencies["host"];

/** The params any one of the host's automation asks takes. */
type AutomationParams = Parameters<HostAsk[keyof HostAsk]>[0];

function fixture() {
  const asked: unknown[] = [];
  const unanswered = (name: string) => (params: AutomationParams) =>
    Effect.sync(() => {
      asked.push([name, params]);
      return { failure: AUTOMATION_CALL_FAILURE.UNANSWERED };
    });
  const rows = automationActRows({
    host: {
      automationList: unanswered("list"),
      automationCreate: unanswered("create"),
      automationChange: unanswered("change"),
      automationDelete: unanswered("delete"),
      automationRun: unanswered("run"),
      automationRuns: unanswered("runs"),
      automationNewWebhookSecret: unanswered("new secret"),
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
        for (const kind of [
          ACT_KIND.AUTOMATIONS_DELETE,
          ACT_KIND.AUTOMATIONS_RUNS,
          ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET,
        ]) {
          assert.deepEqual(
            yield* router.performAct({ kind, payload: { automationId: AUTOMATION_ID } }, sender),
            { status: ACT_OUTCOME_STATUS.REFUSED, reason: ACT[kind].refusal },
          );
        }
      }
      assert.deepEqual(asked, []);
    }),
);

it.effect(
  "a panel's ask reaches the host with its payload, and the host's answer is the panel's",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      const outcome = yield* router.performAct(
        { kind: ACT_KIND.AUTOMATIONS_RUNS, payload: { automationId: AUTOMATION_ID } },
        PANEL,
      );

      assert.deepEqual(outcome, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { failure: AUTOMATION_CALL_FAILURE.UNANSWERED },
      });
      assert.deepEqual(asked, [["runs", { automationId: AUTOMATION_ID }]]);
    }),
);
