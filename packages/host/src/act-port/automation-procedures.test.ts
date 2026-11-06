import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, it } from "@effect/vitest";
import { AUTOMATION_CALL_FAILURE, AUTOMATION_FOLLOW } from "@repo/features/automation-view";
import { Effect } from "effect";
import {
  type ActPortClient,
  AUTOMATION_ACT_KIND,
  type PortActPayload,
  type PortActResult,
} from "../contract/index.js";
import { automationProcedures } from "./automation-procedures.js";
import type { ActSender } from "./base.js";
import type { AutomationProceduresDependencies } from "./index.js";
import { settledAct, type TestActPort, testActPort } from "./testing.js";

const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

function windowClient(
  procedures: Parameters<typeof testActPort<unknown>>[0],
  actor: ActSender,
  trusted = true,
): ActPortClient {
  const port = testActPort<unknown>(procedures);
  ports.push(port);
  return port.as(actor, { trusted });
}

const AUTOMATION_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const RUN_KEY = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const REFUSAL = {
  [AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE]: "Could not change the automation on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE]: "Could not delete the automation on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_RUN]: "Could not run the automation on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]:
    "Could not make a new webhook secret on this system.",
} as const;

type Kind = keyof typeof REFUSAL;

const ACTS: readonly {
  kind: Kind;
  host: string;
  payload: PortActPayload<Kind>;
  call: (client: ActPortClient) => Promise<PortActResult<Kind>>;
}[] = [
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
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET,
    host: "new secret",
    payload: { automationId: AUTOMATION_ID },
    call: (client) =>
      client[AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]({ automationId: AUTOMATION_ID }),
  },
];

type HostAsk = AutomationProceduresDependencies["host"];

type AutomationParams = Parameters<HostAsk[keyof HostAsk]>[0];

function windowPort(actor: typeof PANEL, trusted = true) {
  const asked: unknown[] = [];
  const unanswered = (name: string) => (params: AutomationParams) =>
    Effect.sync(() => {
      asked.push([name, params]);
      return { failure: AUTOMATION_CALL_FAILURE.UNANSWERED };
    });
  const host: HostAsk = {
    automationCreate: unanswered("create"),
    automationChange: unanswered("change"),
    automationDelete: unanswered("delete"),
    automationRun: unanswered("run"),
    automationNewWebhookSecret: unanswered("new secret"),
    automationsFollow: () => Effect.void,
    automationsUnfollow: () => Effect.void,
    automationsRetry: () => Effect.void,
  };
  const client = windowClient(automationProcedures({ host }), actor, trusted);
  return { client, asked };
}

it("a window that is not a panel is refused every automation act in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(OTHER_WINDOW);
  for (const act of ACTS) {
    assert.deepEqual(await settledAct(act.call(client)), { refused: REFUSAL[act.kind] });
  }
  assert.deepEqual(asked, []);
});

it("a frame this build does not trust is refused every automation act, even as a panel, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL, false);
  for (const act of ACTS) {
    assert.deepEqual(await settledAct(act.call(client)), { refused: REFUSAL[act.kind] });
  }
  assert.deepEqual(asked, []);
});

it("a panel's ask reaches the host with its payload, and the host's answer is the panel's", async () => {
  const { client, asked } = windowPort(PANEL);
  for (const act of ACTS) {
    assert.deepEqual(await settledAct(act.call(client)), {
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
  const payload = { automationId: AUTOMATION_ID, extra: true };

  assert.deepEqual(await settledAct(client[AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE](payload)), {
    refused: REFUSAL[AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE],
  });
  assert.deepEqual(asked, []);
});

async function until(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !ready(); turn += 1) await nextTurn();
}

it("a panel's hold on a list follows it at the host once for every stream of it, hears nothing down the hold, and lets it go once its last stream closes", async () => {
  const asked: string[] = [];
  const follows: Pick<HostAsk, "automationsFollow" | "automationsUnfollow"> = {
    automationsFollow: () => Effect.sync(() => void asked.push("follow")),
    automationsUnfollow: () => Effect.sync(() => void asked.push("unfollow")),
  };
  const host = follows as HostAsk;
  const port = testActPort(automationProcedures({ host }));
  ports.push(port);
  const client = port.as(PANEL);
  const scope = { kind: AUTOMATION_FOLLOW.WORKSPACE, id: "workspace-1" } as const;

  const one = await client[AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW](scope);
  const two = await client[AUTOMATION_ACT_KIND.AUTOMATIONS_FOLLOW](scope);
  const first = one.next();
  await until(() => asked.length === 1);
  assert.deepEqual(asked, ["follow"], "two streams of one list share one follow");

  await one.return(undefined);
  await nextTurn();
  assert.deepEqual(asked, ["follow"], "the first stream closing lets nothing go");
  await two.return(undefined);
  await until(() => asked.length === 2);
  assert.deepEqual(asked, ["follow", "unfollow"]);
  assert.deepEqual(await first, { done: true, value: undefined }, "the hold carried nothing");
});
