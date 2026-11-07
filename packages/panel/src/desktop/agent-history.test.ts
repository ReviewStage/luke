// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { agentTab, draftTab } from "@repo/ui/tab-strip-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { NOTHING_HELD } from "../tasks/agent-ref.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { agentsControl, tasksControl } from "../testing/tasks-control.js";
import { MainTabBars } from "./main-tabs.js";

/**
 * agent-history.test.ts -- the task's agents' tab bar: its "+" opens a New
 * agent at once, with no menu between, as ⌘T's ask does, and its History lists the task's
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

/** The bar of a task holding the three agents, the tabs of `openAgents` open, `OPEN`'s alone unless named, ⌘T asking where `asked` says; every tab chosen and agent opened recorded. */
async function mount(
  asked = false,
  openAgents: readonly string[] = [OPEN.id],
): Promise<{ chosen: MainTab[]; opened: string[] }> {
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
    tabs: openAgents.map((id) => agentTab(id)),
    tab: agentTab(OPEN.id),
    openAgents,
    onChoose: (tab: MainTab) => chosen.push(tab),
    newTabAsked: asked,
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      withQueryClient(
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
          keys: asked,
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

  assert.deepEqual(chosen, [draftTab("draft-1")]);
  assert.equal(document.querySelector('[role="listbox"], [role="menu"]'), null);
});

test("⌘T's ask opens a New agent as the + does, once the column has the keys", async () => {
  const { chosen } = await mount(true);

  assert.deepEqual(chosen, [draftTab("draft-1")]);
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

test("History leaves out an archived agent whose tab is open, as it does a live one's", async () => {
  await mount(false, [OPEN.id, ARCHIVED.id]);
  await act(async () => button("Agent history").click());
  const panel =
    document.querySelector<HTMLElement>('[role="dialog"][aria-label="Agent history"]') ??
    assert.fail("History hangs its panel");
  assert.match(panel.textContent ?? "", /Expiry job/u);
  assert.doesNotMatch(panel.textContent ?? "", /Old onboarding copy/u);
});
