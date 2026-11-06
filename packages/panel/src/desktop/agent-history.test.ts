// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { NOTHING_HELD } from "../tasks/agent-ref.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { agentsControl, tasksControl } from "../testing/tasks-control.js";
import { MainTabBars } from "./main-tabs.js";

/**
 * agent-history.test.ts -- the task's agents' tab bar: its "+" opens a New
 * agent at once, with no menu between, and its History lists the task's
 * agents whose tabs are closed and those archived, never one whose tab is
 * open, a press on a row opening that agent. Synthetic throughout.
 */

const ignore = () => undefined;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** An agent on the task, named by its title. */
function agent(id: string, title: string): AgentSummary {
  return {
    id,
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
  };
}

const OPEN = agent("agent-open", "Invite flow");
const CLOSED = agent("agent-closed", "Expiry job");
const ARCHIVED = agent("agent-archived", "Old onboarding copy");

/** The bar of a task holding the three agents, only `OPEN`'s tab open; every tab chosen and agent opened recorded. */
async function mount(): Promise<{ chosen: MainTab[]; opened: string[] }> {
  const chosen: MainTab[] = [];
  const opened: string[] = [];
  const base = tasksControl();
  const agents = agentsControl({
    agents: [OPEN, CLOSED],
    agentIds: [OPEN.id, CLOSED.id],
    archived: [ARCHIVED],
    onNewDraft: () => "draft-1",
  });
  const main = {
    ...base.mainTabs,
    tabs: [{ agent: OPEN.id }],
    tab: { agent: OPEN.id },
    openAgents: [OPEN.id],
    onChoose: (tab: MainTab) => chosen.push(tab),
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MainTabBars, {
          task: { id: "plan-1" },
          main,
          agents,
          unread: [],
          views: {
            held: NOTHING_HELD,
            standings: new Map(),
            onAgentHeld: ignore,
            onWorkerHeld: ignore,
            onWorkerStatus: ignore,
          },
          pins: { pinned: () => false, onPin: ignore },
          keys: false,
          shown: true,
          onOpenAgent: (agentId: string) => opened.push(agentId),
        }),
      ),
    ),
  );
  return { chosen, opened };
}

/** The button named `label`, wherever the window draws it. */
function button(label: string): HTMLButtonElement {
  return (
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
    assert.fail(`${label} stands`)
  );
}

test("the column's + opens a New agent at once, with no menu between", async () => {
  const { chosen } = await mount();
  await act(async () => button("New agent").click());

  assert.deepEqual(chosen, [{ draft: "draft-1" }]);
  assert.equal(document.querySelector('[role="listbox"], [role="menu"]'), null);
});

test("History lists the closed and the archived agents but not one whose tab is open, and a row's press opens its agent", async () => {
  const { opened } = await mount();
  await act(async () => button("Agent history").click());
  const panel =
    document.querySelector<HTMLElement>('[role="dialog"][aria-label="Agent history"]') ??
    assert.fail("History hangs its panel");
  const words = panel.textContent ?? "";

  assert.match(words, /Expiry job/u);
  assert.match(words, /Old onboarding copy/u);
  assert.doesNotMatch(words, /Invite flow/u);

  const closedRow =
    [...panel.querySelectorAll<HTMLElement>("li button")].find((each) =>
      each.textContent?.includes(CLOSED.title ?? ""),
    ) ?? assert.fail("the closed agent's row");
  await act(async () => closedRow.click());
  assert.deepEqual(opened, [CLOSED.id]);
});
