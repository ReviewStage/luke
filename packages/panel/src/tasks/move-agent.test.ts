// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_BRIEF,
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentRunsOnRequest,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { DEVICE_SETUP } from "@repo/features/device-agent-wire";
import type { MacOffer } from "@repo/features/models-wire";
import { TASK_MODE } from "@repo/features/task-wire";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { MenuEntry } from "../desktop/action-menu.js";
import { agentMenuGroups, useAgentActions } from "../desktop/agent-actions.js";
import { handState, stateWith } from "../testing/app-state.js";
import { withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { agentsControl } from "../testing/tasks-control.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * move-agent.test.ts -- an agent's menu offers Move to › while Bring your own host is on and a Continue of the agent is offered: Cloud and each of the member's devices but the one it runs on, a device not ready dimmed and saying why, and from a device each place saying only pushed work comes along; a pick continues the agent at that place. It is offered nowhere while the agent works, where no Continue is, or with the experiment off.
 *
 * Synthetic agents and devices throughout.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const STUDIO = "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f";
const ATTIC = "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d";

/** A device ready for agents, and one still getting ready. */
const MACS: readonly MacOffer[] = [
  { deviceId: STUDIO, name: "Studio", providers: [] },
  { deviceId: ATTIC, name: "Attic", providers: [], setup: DEVICE_SETUP.PREPARING },
];

/** The agent at rest in the cloud. */
const AT_REST: AgentSummary = {
  id: AGENT,
  planId: TASK,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Fix the tile",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: AGENT_BRIEF.DESCRIPTION,
};

/** The same agent on Studio. */
const ON_STUDIO: AgentSummary = {
  ...AT_REST,
  machine: AGENT_MACHINE.DEVICE,
  mac: { name: "Studio", deviceId: STUDIO },
};

/** Every continue the menu asked, in order. */
let continued: { agentId: string; runsOn: AgentRunsOnRequest | undefined }[] = [];

afterEach(() => {
  continued = [];
  document.body.innerHTML = "";
});

/** The control of the agent's task, listing it, which continues into `continued`. */
function controlOf(agent: AgentSummary, overrides: Partial<AgentsControl> = {}): AgentsControl {
  return agentsControl({
    agents: [agent],
    agentIds: [agent.id],
    macs: MACS,
    continueAgent: (agentId, _note, _attachments, runsOn) => {
      continued.push({ agentId, runsOn });
      return Promise.resolve(undefined);
    },
    ...overrides,
  });
}

/** The agent's menu as its tab offers it once the window's state landed, with Bring your own host on unless `experimentOn` is false. */
async function menuOf(
  agent: AgentSummary,
  control: AgentsControl,
  experimentOn = true,
): Promise<MenuEntry[]> {
  const experiments = experimentOn ? experimentsOn(EXPERIMENT.BRING_YOUR_OWN_HOST) : {};
  handState(experiments);
  // Note that the menu is read once, so the document is in the client from its first frame.
  writeAppState(stateWith(experiments, {}));
  let groups: MenuEntry[][] = [];
  function Probe(): null {
    const actions = useAgentActions(agent, control, {
      label: agent.title ?? "",
      shown: true,
      terminals: { onOpenTerminal: undefined },
    });
    groups = agentMenuGroups(actions.doors);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(withQueryClient(createElement(Probe))));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  act(() => root.unmount());
  return groups.flat();
}

/** The menu's Move to ›, none where it offers none. */
function moveTo(entries: readonly MenuEntry[]) {
  const entry = entries.find((each) => each.label === "Move to");
  return entry !== undefined && "items" in entry ? entry : undefined;
}

test("an agent at rest in the cloud moves to each of the member's devices, one not ready dimmed and saying why, and a pick continues it there", async () => {
  const entry =
    moveTo(await menuOf(AT_REST, controlOf(AT_REST))) ?? assert.fail("Move to is offered");

  assert.deepEqual(
    entry.items.map(({ label, detail, disabled }) => ({ label, detail, disabled })),
    [
      { label: "Studio", detail: undefined, disabled: false },
      { label: "Attic", detail: "Getting ready…", disabled: true },
    ],
  );
  entry.items[0]?.onSelect();
  assert.deepEqual(continued, [
    { agentId: AGENT, runsOn: { machine: AGENT_MACHINE.DEVICE, deviceId: STUDIO } },
  ]);
});

test("an agent on a device moves to the cloud or another device, never its own, each saying only pushed work comes along", async () => {
  const entry =
    moveTo(await menuOf(ON_STUDIO, controlOf(ON_STUDIO))) ?? assert.fail("Move to is offered");

  assert.deepEqual(
    entry.items.map(({ label, detail }) => ({ label, detail })),
    [
      { label: "Cloud", detail: "Only pushed work comes along" },
      { label: "Attic", detail: "Getting ready…" },
    ],
  );
  entry.items[0]?.onSelect();
  assert.deepEqual(continued, [{ agentId: AGENT, runsOn: { machine: AGENT_MACHINE.VERCEL } }]);
});

test("an agent on a device the service did not name is offered the cloud alone", async () => {
  const unnamed = { ...ON_STUDIO, mac: { name: "Studio" } };
  const entry =
    moveTo(await menuOf(unnamed, controlOf(unnamed))) ?? assert.fail("Move to is offered");

  assert.deepEqual(
    entry.items.map((each) => each.label),
    ["Cloud"],
  );
});

test("Move to is offered nowhere while the agent works, where no Continue is offered, or with Bring your own host off", async () => {
  const working = { ...AT_REST, status: AGENT_STATUS.RUNNING };
  const pilotsHelper = controlOf(AT_REST, { mode: TASK_MODE.PILOT });
  const otherTasks = controlOf(AT_REST, { agents: [] });
  const noStart = controlOf(AT_REST, { continueAgent: undefined });
  const archived = { ...AT_REST, archivedAt: 2 };

  assert.deepEqual(
    [
      moveTo(await menuOf(working, controlOf(working))),
      moveTo(await menuOf(AT_REST, pilotsHelper)),
      moveTo(await menuOf(AT_REST, otherTasks)),
      moveTo(await menuOf(AT_REST, noStart)),
      moveTo(await menuOf(archived, controlOf(archived))),
      moveTo(await menuOf(AT_REST, controlOf(AT_REST), false)),
    ],
    [undefined, undefined, undefined, undefined, undefined, undefined],
  );
});
