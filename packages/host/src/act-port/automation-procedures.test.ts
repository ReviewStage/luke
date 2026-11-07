import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AUTOMATION_ACTION, AUTOMATION_TRIGGER } from "@repo/features/automation-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import { AUTOMATION_ACT_KIND } from "../contract/index.js";
import { hostActPort } from "../testing/host-act-port.js";
import type { ActSender } from "./base.js";

/**
 * The Automations pages' acts, through the act port as a window calls them:
 * only a panel of this build's own renderer asks; any other window, and a
 * frame this build does not trust, are refused in each kind's own words
 * before the service is asked. The automations' live follow is held in
 * `live-follows.test.ts`.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const AUTOMATION_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const WORKSPACE_ID = "workspace-1";

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [AUTOMATION_ACT_KIND.AUTOMATIONS_CREATE]: "Could not make the automation on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE]: "Could not change the automation on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE]: "Could not delete the automation on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_RUN]: "Could not run the automation on this system.",
  [AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]:
    "Could not make a new webhook secret on this system.",
} as const;

/** One ask of each kind, with a payload its schema takes. */
const ASKS: readonly {
  readonly kind: keyof typeof REFUSAL;
  readonly payload: WireBoundaryInput;
}[] = [
  {
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_CREATE,
    payload: {
      workspaceId: WORKSPACE_ID,
      repositories: ["acme/web"],
      name: "Triage new issues",
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
      action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage the issues opened today." },
    },
  },
  {
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE,
    payload: { automationId: AUTOMATION_ID, change: { enabled: false } },
  },
  { kind: AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE, payload: { automationId: AUTOMATION_ID } },
  {
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_RUN,
    payload: {
      automationId: AUTOMATION_ID,
      idempotencyKey: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    },
  },
  {
    kind: AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET,
    payload: { automationId: AUTOMATION_ID },
  },
];

it.effect(
  "a window that is not a panel, and a frame this build does not trust, are refused every automation act in the kind's own words, and the service is not asked",
  () =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort();
      const refused = [];
      for (const ask of ASKS) {
        refused.push(yield* port.perform(ask, OTHER_WINDOW));
        refused.push(yield* port.perform(ask, PANEL, { trusted: false }));
      }

      assert.deepEqual(
        refused,
        ASKS.flatMap((ask) => [{ refused: REFUSAL[ask.kind] }, { refused: REFUSAL[ask.kind] }]),
      );
      assert.deepEqual(requests, []);
    }),
);
