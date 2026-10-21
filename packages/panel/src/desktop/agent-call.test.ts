// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { LIVE_STATUS } from "@luke/live";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { AgentCallDoors } from "../tasks/agent-call.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import { handState, stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

/**
 * An agent's tab takes calls where the platform has a voice: a Call button
 * beside Dictate, which calls the agent, and while a call into it stands, the
 * call bar at its foot in the button's place, its glyph wearing the live
 * mark. A platform with no voice hands the tab no doors, and it draws none.
 * Synthetic task and agent.
 */

const AGENT: CodingAgentSummary = {
  id: "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40",
  planId: DOCUMENT_TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite expiry",
  createdAt: 3,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The task open on its agent's tab, the voice as `voice` stands, the tab taking calls through `calls`. */
async function mountOn(
  calls: AgentCallDoors | undefined,
  voice: VoiceView = IDLE_VOICE_VIEW,
): Promise<HTMLElement> {
  handState(
    {},
    {
      settings: appSettingsWire(settingsView({ voiceAvailable: true })),
      voice: { ...stateWith({}, {}).voice, view: voice },
    },
  );
  const base = tasksControl();
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    mainTabs: {
      ...base.mainTabs,
      tabs: [{ agent: AGENT.id }],
      tab: { agent: AGENT.id },
      openAgents: [AGENT.id],
    },
    agents: codingAgentsControl({ agents: [AGENT], agentIds: [AGENT.id] }),
    calls,
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

/** The agent tab's Call button, where it stands. */
function callButton(page: HTMLElement): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>('.agent-call-button button[aria-label="Call"]');
}

test("an agent's tab offers a Call button beside Dictate where the platform has a voice, which calls that agent, and none where it has not", async () => {
  const pressed: string[] = [];
  const page = await mountOn({ onPress: (agentId) => pressed.push(agentId) });
  const call = callButton(page);
  assert.ok(call, "the Call button stands");
  assert.ok(
    call.closest(".agent-tab")?.querySelector(".dictate-button"),
    "beside Dictate, in the agent's own composer",
  );
  assert.ok(call.closest(".ph-no-capture"), "inside the tab left out of the recording");
  act(() => call.click());
  assert.deepEqual(pressed, [AGENT.id]);
  act(() => roots.pop()?.unmount());

  const web = await mountOn(undefined);
  assert.equal(callButton(web), null);
  assert.equal(web.querySelector(".agent-call-foot"), null);
});

test("while a call into the agent stands, its tab's foot draws the call bar in the Call button's place and its glyph wears the live mark", async () => {
  const listening: VoiceView = {
    ...IDLE_VOICE_VIEW,
    voiceStatus: LIVE_STATUS.LISTENING,
    listening: true,
    call: { taskId: DOCUMENT_TASK.id, agentId: AGENT.id },
  };
  const page = await mountOn({ onPress: () => undefined }, listening);

  assert.equal(callButton(page), null, "the call bar's own microphone stands in its place");
  const foot = page.querySelector(".agent-call-foot");
  assert.ok(foot, "the call bar stands at the tab's foot");
  assert.ok(foot.querySelector('button[aria-label="End call"]'));
  assert.ok(
    page.querySelector('.main-tabs [role="tab"] .agent-calling-glyph'),
    "the agent's tab wears the live mark",
  );
});
