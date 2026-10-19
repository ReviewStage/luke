import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { AUTOMATION_CALL_FAILURE } from "@luke/features/automation-view";
import { Effect } from "effect";
import { type ActPortClient, AUTOMATION_ACT_KIND } from "../contract/index.js";
import type { AutomationProceduresDependencies } from "./index.js";
import {
  CALL,
  closeWindowPorts,
  openWindowPort,
  PANEL,
  settled,
  UNREACHED_DEPENDENCIES,
  VOICE,
} from "./testing.js";

/**
 * The Automations pages' acts, through the act port as a window calls them:
 * only a panel of this build's own renderer asks; the voice and call
 * windows, and a frame this build does not trust, are refused in each
 * kind's own words before the host is asked; and a panel's ask reaches the
 * host with its payload as the panel sent it.
 */

const AUTOMATION_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const RUN_KEY = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [AUTOMATION_ACT_KIND.AUTOMATIONS_LIST]: "Could not read the automations on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE]: "Could not change the automation on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE]: "Could not delete the automation on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_RUN]: "Could not run the automation on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS]: "Could not read the automation's runs on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]:
    "Could not make a new webhook secret on this system.",
} as const;

type Kind = keyof typeof REFUSAL;

/** One call of each kind, with the payload a panel sends and the host ask it reaches. */
const ACTS: readonly {
  kind: Kind;
  host: string;
  payload: unknown;
  call: (client: ActPortClient) => Promise<unknown>;
}[] = [
  {
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_LIST,
    host: "list",
    payload: { workspaceId: "workspace-1" },
    call: (client) => client[AUTOMATION_ACT_KIND.AUTOMATIONS_LIST]({ workspaceId: "workspace-1" }),
  },
  {
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE,
    host: "change",
    payload: { automationId: AUTOMATION_ID, change: { enabled: false } },
    call: (client) =>
      client[AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE]({
        automationId: AUTOMATION_ID,
        change: { enabled: false },
      }),
  },
  {
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE,
    host: "delete",
    payload: { automationId: AUTOMATION_ID },
    call: (client) =>
      client[AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE]({ automationId: AUTOMATION_ID }),
  },
  {
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_RUN,
    host: "run",
    payload: { automationId: AUTOMATION_ID, idempotencyKey: RUN_KEY },
    call: (client) =>
      client[AUTOMATION_ACT_KIND.AUTOMATIONS_RUN]({
        automationId: AUTOMATION_ID,
        idempotencyKey: RUN_KEY,
      }),
  },
  {
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS,
    host: "runs",
    payload: { automationId: AUTOMATION_ID },
    call: (client) => client[AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS]({ automationId: AUTOMATION_ID }),
  },
  {
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET,
    host: "new secret",
    payload: { automationId: AUTOMATION_ID },
    call: (client) =>
      client[AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]({ automationId: AUTOMATION_ID }),
  },
];

type HostAsk = AutomationProceduresDependencies["host"];

/** The params any one of the host's automation asks takes. */
type AutomationParams = Parameters<HostAsk[keyof HostAsk]>[0];

afterEach(closeWindowPorts);

/** A window's act port over a host that answers every automation ask unanswered, and what it was asked. */
function windowPort(actor: typeof PANEL, trusted = true) {
  const asked: unknown[] = [];
  const unanswered = (name: string) => (params: AutomationParams) =>
    Effect.sync(() => {
      asked.push([name, params]);
      return { failure: AUTOMATION_CALL_FAILURE.UNANSWERED };
    });
  const host: HostAsk = {
    automationList: unanswered("list"),
    automationCreate: unanswered("create"),
    automationChange: unanswered("change"),
    automationDelete: unanswered("delete"),
    automationRun: unanswered("run"),
    automationRuns: unanswered("runs"),
    automationNewWebhookSecret: unanswered("new secret"),
  };
  const client = openWindowPort(
    { ...UNREACHED_DEPENDENCIES, automations: { host } },
    actor,
    trusted,
  );
  return { client, asked };
}

it("the voice and call windows are refused every automation act in the kind's own words, and the host is not asked", async () => {
  for (const actor of [VOICE, CALL]) {
    const { client, asked } = windowPort(actor);
    for (const act of ACTS) {
      assert.deepEqual(await settled(() => act.call(client)), { refused: REFUSAL[act.kind] });
    }
    assert.deepEqual(asked, []);
  }
});

it("a frame this build does not trust is refused every automation act, even as a panel, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL, false);
  for (const act of ACTS) {
    assert.deepEqual(await settled(() => act.call(client)), { refused: REFUSAL[act.kind] });
  }
  assert.deepEqual(asked, []);
});

it("a panel's ask reaches the host with its payload, and the host's answer is the panel's", async () => {
  const { client, asked } = windowPort(PANEL);
  for (const act of ACTS) {
    assert.deepEqual(await settled(() => act.call(client)), {
      answer: { failure: AUTOMATION_CALL_FAILURE.UNANSWERED },
    });
  }
  assert.deepEqual(
    asked,
    ACTS.map((act) => [act.host, act.payload]),
  );
});

it("a payload carrying a key its kind does not name is refused in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);
  const runs = client[AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS] as (
    payload: unknown,
  ) => Promise<unknown>;

  assert.deepEqual(await settled(() => runs({ automationId: AUTOMATION_ID, extra: true })), {
    refused: REFUSAL[AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS],
  });
  assert.deepEqual(asked, []);
});
