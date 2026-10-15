// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Plan } from "@luke/features/plan-wire";
import { DOCUMENT_REGION, PLANS_PAGE } from "@luke/ui/planning-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl, plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { MAIN_TAB } from "../planning/use-main-tabs";
import { NO_LOOKS } from "../planning/use-plan-looks";
import { SIDE_PANEL_TAB } from "../planning/use-side-panel";
import { DesktopPlans } from "./desktop-plans";

/**
 * tab-actions.test.ts -- a tab whose menu acts on what it shows, an agent's
 * or a subagent's, drops that menu from a ⋯ as well as on a right-click,
 * the same items either way; every other tab, whose menu only keeps the tab,
 * answers a right-click alone.
 */

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/web",
  document: { body: "", assumptions: [] },
};

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: PLAN.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite expiry job",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

const PAGE_ID = "5d2b7c1e-9a3f-4e6d-8c2b-1f0e9d8c7b6a";

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/**
 * The plan's page with a tab of every kind open: the plan's, an agent's,
 * the draft's, and the Inbox's in its column, and in the side panel the
 * fixed tabs, the agent's delegated worker's, a file's, the agent's
 * Changes and Terminal, and a page's.
 */
function mountEveryTab(): HTMLElement {
  const subagent = { subagent: "call-1", delegation: { agent: AGENT.id, task: "Audit retries" } };
  const control = plansControl({
    page: PLANS_PAGE.DOCUMENT,
    activePlanId: PLAN.id,
    region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
    mainTabs: {
      ...plansControl().mainTabs,
      tabs: [MAIN_TAB.PLAN, { agent: AGENT.id }, { draft: "draft-1" }, MAIN_TAB.INBOX],
      tab: { agent: AGENT.id },
      openAgents: [AGENT.id],
    },
    sidePanel: {
      ...plansControl().sidePanel,
      open: true,
      subagents: [subagent],
      files: [{ path: "src/invite.ts", range: undefined, opened: 1, browsedOn: PLAN.id }],
      changes: [{ changes: AGENT.id }],
      terminals: [{ terminal: AGENT.id }],
      pages: [{ page: PAGE_ID }],
      tab: SIDE_PANEL_TAB.BOARD,
    },
    pages: [{ id: PAGE_ID, title: "Invite flow", version: 1, at: 1 }],
    agents: codingAgentsControl({
      agents: [AGENT],
      agentIds: [AGENT.id],
      draft: {
        id: "draft-1",
        task: "",
        attachments: [],
        choice: undefined,
        disabledServers: [],
      },
    }),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopPlans, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          captions: undefined,
          plans: control,
        }),
      ),
    ),
  );
  return container;
}

/** The menu standing open, if one is: drawn and not on its way out. */
function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
}

/** What the open menu offers, each item's words and whether it applies now, then the menu closed by Escape. */
function readAndClose(): string[] {
  const menu = openMenu();
  assert.ok(menu, "a menu stands open");
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map(
    (item) =>
      `${item.querySelector(".plan-menu-label")?.textContent}${item.disabled ? " (off)" : ""}`,
  );
  act(() => {
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(openMenu(), null, "Escape closed the menu");
  return items;
}

/** What a right-click on the tab in `pill` offers, the menu closed again. */
function rightClick(pill: HTMLElement): string[] {
  const tab = pill.querySelector<HTMLElement>('[role="tab"]');
  assert.ok(tab, "the pill holds its tab");
  act(() => {
    tab.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 20 }),
    );
  });
  return readAndClose();
}

/** Every tab of both strips, by its label. */
function tabsByLabel(container: HTMLElement): Map<string, HTMLElement> {
  const pills = [...container.querySelectorAll<HTMLElement>(".tab")];
  return new Map(
    pills.map((pill) => [pill.querySelector(".tab-label")?.textContent ?? "", pill] as const),
  );
}

test("an agent's tab and a subagent's drop from a ⋯ the very menu a right-click opens, and no other tab wears one", () => {
  const container = mountEveryTab();
  const tabs = tabsByLabel(container);
  const withMore = [...tabs].flatMap(([label, pill]) =>
    pill.querySelector(".tab-more") === null ? [] : [label],
  );
  assert.deepEqual(withMore.sort(), ["Audit retries", "Invite expiry job"]);
  // Every other kind's menu only keeps the tab, so it answers a right-click alone.
  for (const label of [
    "Teammate invitations",
    "New coding agent",
    "Inbox",
    "Board",
    "Code",
    "Call",
    "invite.ts",
    "Changes: Invite expiry job",
    "Terminal Invite expiry job",
    "Invite flow",
  ]) {
    const pill = tabs.get(label);
    assert.ok(pill, `the ${label} tab stands`);
    assert.equal(pill.querySelector(".tab-more"), null, `the ${label} tab wears no ⋯`);
    assert.ok(rightClick(pill).length > 0, `the ${label} tab still answers a right-click`);
  }
  for (const label of withMore) {
    const pill = tabs.get(label);
    const more = pill?.querySelector<HTMLButtonElement>(".tab-more");
    assert.ok(pill && more, `the ${label} tab wears a ⋯`);
    const fromRightClick = rightClick(pill);
    assert.equal(more.getAttribute("aria-label"), `Actions for ${label}`);
    act(() => more.click());
    assert.equal(more.getAttribute("aria-expanded"), "true");
    assert.deepEqual(readAndClose(), fromRightClick, `the ${label} tab's ⋯ offers its right-click`);
    // Closed by key, the menu hands focus back to the ⋯ that opened it.
    assert.equal(document.activeElement, more);
  }
});

test("the chosen tab's ⋯ is the strip's one stop after the tab, and another tab's ⋯ is for the pointer alone", () => {
  const container = mountEveryTab();
  const tabs = tabsByLabel(container);
  const chosen = tabs.get("Invite expiry job")?.querySelector<HTMLButtonElement>(".tab-more");
  const other = tabs.get("Audit retries")?.querySelector<HTMLButtonElement>(".tab-more");
  assert.equal(chosen?.tabIndex, 0);
  assert.equal(other?.tabIndex, -1);
});
