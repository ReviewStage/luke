// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import { pageFrameUrl } from "@luke/features/page-frame";
import type { Task } from "@luke/features/task-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { AgentsControl } from "../tasks/use-agents.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handCapabilities } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { onSideBundles, unlandedBundles } from "../testing/side-bundles.js";
import { agentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
// Note that a Pull request tab is loaded as the side panel loads it, on first use
// (`pages-on-demand.ts`), so the module is read here first and its load settles
// within the test's own ticks.
import "../tasks/agent-pull-request-tab.js";
import { DesktopTasks } from "./desktop-tasks.js";

/**
 * tab-actions.test.ts -- a column's bar holds a ⋯ for its chosen tab's
 * content actions: on an agent's or a subagent's tab the actions its
 * right-click offers on what it shows, the one agent menu, without the
 * tab's own keeping (Close, Close others, Pin), which stays on the
 * right-click alone; the task's column draws no ⋯ of the task's, whose own
 * document menu the Plan tab's ⋯ and right-click offer instead, pinning
 * the task rather than the tab. A tab with no content action shows no ⋯,
 * and no tab wears one of its own. A Pull request tab's ⋯ also offers what
 * its body hands up, Open on GitHub and Refresh, which no other tab's offers
 * but the Plan tab's, the task's own.
 */

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/web",
  document: { body: "", assumptions: [] },
};

const AGENT: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite expiry job",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
};

const PAGE_ID = "5d2b7c1e-9a3f-4e6d-8c2b-1f0e9d8c7b6a";

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  handCapabilities(DESKTOP_CAPABILITIES);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The agent's delegated worker, whose tab the side panel holds. */
const SUBAGENT = { subagent: "call-1", delegation: { agent: AGENT.id, task: "Audit retries" } };

/** What a right-click offers on a tab itself rather than on what it shows. */
const TAB_KEEPING = new Set(["Close", "Close others", "Pin", "Unpin", "Move left", "Move right"]);

/** Waits out the few microtasks the window's document takes to arrive after the first draw. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * The task's page with a tab of every kind open, `main` chosen in its column
 * and `side` in the side panel: the Call's, an agent's, and the draft's in
 * the column, and in the side panel the fixed tabs, the Plan and the Inbox
 * among them, the agent's delegated worker's, a file's, the agent's Changes
 * and Terminal, and a page's.
 */
async function mountEveryTab(
  chosen: { main: MainTab; side: SidePanelTab },
  pullRequests: AgentsControl["pullRequests"] = new Map(),
): Promise<HTMLElement> {
  const control = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    mainTabs: {
      ...tasksControl().mainTabs,
      tabs: [{ agent: AGENT.id }, { draft: "draft-1" }],
      tab: chosen.main,
      openAgents: [AGENT.id],
    },
    sidePanel: {
      ...tasksControl().sidePanel,
      open: true,
      subagents: [SUBAGENT],
      files: [{ path: "src/invite.ts", range: undefined, opened: 1, browsedOn: TASK.id }],
      changes: [{ changes: AGENT.id }],
      terminals: [{ terminal: AGENT.id }],
      pages: [{ page: PAGE_ID }],
      tab: chosen.side,
    },
    pages: [{ id: PAGE_ID, title: "Invite flow", version: 1, at: 1 }],
    agents: agentsControl({
      agents: [AGENT],
      agentIds: [AGENT.id],
      pullRequests,
      draft: {
        id: "draft-1",
        prompt: "",
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
        // Only the tabs' bars are asked about, so no bundle lands under them.
        onSideBundles(
          unlandedBundles(),
          createElement(DesktopTasks, {
            summary: UNPINNED_SUMMARY,
            looks: NO_LOOKS,
            tasks: control,
          }),
        ),
      ),
    ),
  );
  await settle();
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
      `${item.querySelector(".luke-menu-item-label")?.textContent}${item.disabled ? " (off)" : ""}`,
  );
  act(() => {
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(openMenu(), null, "Escape closed the menu");
  return items;
}

/** What a right-click on the chosen tab of `strip` offers, the menu closed again. */
function rightClickChosen(strip: HTMLElement): string[] {
  const tab = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  assert.ok(tab, "the strip has a chosen tab");
  act(() => {
    tab.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 20 }),
    );
  });
  return readAndClose();
}

/** The two columns' bars: the task's column's toolbar, and the side panel's. */
interface Bars {
  main: HTMLElement;
  side: HTMLElement;
}

/** The two columns' bars, as the task's page draws them. */
function bars(container: HTMLElement): Bars {
  const main = container.querySelector<HTMLElement>(".desktop-task-main .luke-toolbar");
  const side = container.querySelector<HTMLElement>(".side-panel-bar");
  assert.ok(main && side, "both columns draw their bars");
  return { main, side };
}

/** The buttons standing in a bar's ⋯ slot. */
function slotButtons(bar: HTMLElement): HTMLButtonElement[] {
  const slot = bar.querySelector(".toolbar-tab-actions");
  assert.ok(slot, "the bar keeps its ⋯ slot");
  return [...slot.querySelectorAll<HTMLButtonElement>("button")];
}

/** Presses the one ⋯ in a bar's slot and reads what it offers, checking focus comes back to it. */
function pressBarMore(bar: HTMLElement): string[] {
  const [more, ...others] = slotButtons(bar);
  assert.ok(more, "the bar shows a ⋯");
  assert.equal(others.length, 0, "the bar shows one ⋯");
  act(() => more.click());
  const items = readAndClose();
  assert.equal(document.activeElement, more, "closed by key, the menu hands focus back to the ⋯");
  return items;
}

test("a subagent's tab puts its right-click's content actions, and none of the tab's keeping, behind its bar's ⋯, and so does an agent's tab in the column's toolbar, whose right-click leads with the tab's keeping and then the agent's one menu", async () => {
  const container = await mountEveryTab({ main: { agent: AGENT.id }, side: SUBAGENT });
  const { main, side } = bars(container);
  const fromRightClick = rightClickChosen(side);
  const fromMore = pressBarMore(side);
  assert.deepEqual(fromMore, ["Copy link", "Copy concise transcript", "Copy full transcript"]);
  // The same items as the right-click's, less the tab's own keeping, which stays there.
  assert.deepEqual(
    fromMore,
    fromRightClick.filter((item) => !TAB_KEEPING.has(item.replace(" (off)", ""))),
  );
  assert.ok(
    fromRightClick.includes("Close others") || fromRightClick.includes("Close others (off)"),
  );

  const agentItems = rightClickChosen(main);
  assert.deepEqual(agentItems, [
    "Move right",
    "Close",
    "Close others",
    "Pin",
    "Copy link",
    "Copy concise transcript",
    "Copy full transcript",
    "Rename",
    "Show terminal",
    "Archive",
    "Permanently delete",
  ]);
  const agentMore = pressBarMore(main);
  assert.deepEqual(
    agentMore,
    agentItems.filter((item) => !TAB_KEEPING.has(item.replace(" (off)", ""))),
    "the column's ⋯ offers the agent's items, not the task's",
  );
  assert.ok(!agentMore.includes("Mark done"), "none of the task's");
});

test("the column's toolbar draws the chosen agent's ⋯ alone, no ⋯ of the task's beside it, and none on the draft's tab", async () => {
  const cases = [
    [{ agent: AGENT.id }, [`${AGENT.title} actions`]],
    [{ draft: "draft-1" }, []],
  ] as const;
  for (const [main, labels] of cases) {
    const container = await mountEveryTab({ main, side: SIDE_PANEL_TAB.INBOX });
    const toolbar = bars(container).main;
    assert.deepEqual(
      [...toolbar.querySelectorAll('button[aria-label$="actions"]')].map((button) =>
        button.getAttribute("aria-label"),
      ),
      labels,
      `the ⋯ beside ${JSON.stringify(main)}`,
    );
    act(() => roots.pop()?.unmount());
    container.remove();
  }
});

test("the Plan tab's ⋯ and its right-click offer the task's own document menu, which pins the task rather than the tab and leaves out Mark done, Cancel task, and Change repository, while the column's ⋯ stays the agent's", async () => {
  const container = await mountEveryTab({ main: { agent: AGENT.id }, side: SIDE_PANEL_TAB.PLAN });
  const { main, side } = bars(container);
  const fromMore = pressBarMore(side);
  assert.deepEqual(fromMore, [
    "Copy plan",
    "Copy link",
    "Rename",
    "Version history",
    "Mark as unread",
    "Pin",
    "Move to section",
    "Open on GitHub",
    "Permanently delete",
  ]);
  // The right-click leads with the tab's keeping, which holds no Pin tab: the one Pin is the task's, among its own.
  const fromRightClick = rightClickChosen(side);
  const keeping = fromRightClick.slice(0, fromRightClick.indexOf("Copy plan"));
  assert.ok(
    keeping.includes("Close") && !keeping.includes("Pin"),
    `keeping: ${keeping.join(", ")}`,
  );
  assert.deepEqual(fromRightClick.slice(keeping.length), fromMore);
  const agentMore = pressBarMore(main);
  assert.ok(
    !agentMore.includes("Copy plan") && !agentMore.includes("Version history"),
    "the column's ⋯ offers none of the task's items",
  );
});

test("a tab with no content action shows no ⋯ in its bar, though its right-click still answers, and no tab wears a ⋯ of its own", async () => {
  const without: { main: MainTab; side: SidePanelTab }[] = [
    { main: { draft: "draft-1" }, side: SIDE_PANEL_TAB.INBOX },
    { main: { draft: "draft-1" }, side: { file: "src/invite.ts" } },
    { main: { draft: "draft-1" }, side: { terminal: AGENT.id } },
  ];
  for (const chosen of without) {
    const container = await mountEveryTab(chosen);
    const { main, side } = bars(container);
    for (const bar of [main, side]) {
      const label = bar.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
      assert.deepEqual(slotButtons(bar), [], `the ${label} tab shows no ⋯`);
      assert.ok(rightClickChosen(bar).length > 0, `the ${label} tab answers a right-click`);
    }
    assert.equal(container.querySelector(".luke-tab [aria-haspopup]"), null, "no tab wears a ⋯");
    act(() => roots.pop()?.unmount());
    container.remove();
  }
});

/** The agent's pull request, as what it published names it. */
const PULL_REQUEST: AgentPullRequest = {
  number: 42,
  title: "Expire invitations",
  url: "https://github.com/acme/web/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 210,
  deletions: 14,
  changedFiles: 6,
};

test("the Pull request tab's bar ⋯ offers Copy link first, then Open on GitHub and Refresh, which no other tab's offers but the Plan tab's, the task's own, and opens the pull request on GitHub", async () => {
  const opened: string[] = [];
  fakeAppPlatform({
    ...QUIET_PANEL,
    pageFrameUrl,
    openGitHub: (url) => {
      opened.push(url);
    },
  });
  const published = new Map([[AGENT.id, PULL_REQUEST]]);
  const container = await mountEveryTab(
    { main: { draft: "draft-1" }, side: { changes: AGENT.id } },
    published,
  );
  const { side } = bars(container);
  assert.deepEqual(pressBarMore(side), ["Copy link", "Open on GitHub", "Refresh"]);
  assert.ok(
    !rightClickChosen(side).some((item) => item === "Open on GitHub" || item === "Refresh"),
    "a right-click keeps to the tab's own and its link",
  );
  const [more] = slotButtons(side);
  act(() => more?.click());
  const github = [
    ...(openMenu()?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ].find((each) => each.querySelector(".luke-menu-item-label")?.textContent === "Open on GitHub");
  assert.ok(github, "the ⋯ offers Open on GitHub");
  await act(async () => github.click());
  assert.deepEqual(opened, [PULL_REQUEST.url]);
  act(() => roots.pop()?.unmount());
  container.remove();

  for (const other of [SUBAGENT, { page: PAGE_ID }, SIDE_PANEL_TAB.PLAN] as const) {
    const each = await mountEveryTab({ main: { draft: "draft-1" }, side: other }, published);
    const items = pressBarMore(bars(each).side);
    // The Plan tab's Open on GitHub is the task's repository's, not the pull request's.
    assert.ok(
      (other === SIDE_PANEL_TAB.PLAN || !items.includes("Open on GitHub")) &&
        !items.includes("Refresh"),
      `the ${JSON.stringify(other)} tab offers no Refresh`,
    );
    act(() => roots.pop()?.unmount());
    each.remove();
  }
});

/** Main's clipboard, keeping each copy the window asks of it. */
function installClipboard(): string[] {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied), pageFrameUrl });
  return copied;
}

test("each tab whose thing has a link offers Copy link in its right-click and its bar's ⋯, copying the agent's, its worker's, its Changes', a page's, or the Plan tab's, the task's own", async () => {
  const copied = installClipboard();
  const task = `https://tryluke.dev/workspace-personal/plan/${TASK.id}`;
  const agent = `https://tryluke.dev/workspace-personal/agent/${AGENT.id}`;
  const cases: [{ main: MainTab; side: SidePanelTab }, "main" | "side", string][] = [
    [{ main: { agent: AGENT.id }, side: SIDE_PANEL_TAB.INBOX }, "main", agent],
    [{ main: { draft: "draft-1" }, side: SUBAGENT }, "side", `${agent}/worker/call-1`],
    [{ main: { draft: "draft-1" }, side: { changes: AGENT.id } }, "side", `${agent}/changes`],
    [{ main: { draft: "draft-1" }, side: { page: PAGE_ID } }, "side", `${task}/page/${PAGE_ID}`],
    [{ main: { draft: "draft-1" }, side: SIDE_PANEL_TAB.PLAN }, "side", task],
  ];
  for (const [chosen, column] of cases) {
    const container = await mountEveryTab(chosen);
    const tab = bars(container)[column].querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    assert.ok(tab);
    act(() => {
      tab.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 20,
        }),
      );
    });
    const item = [
      ...(openMenu()?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ].find((each) => each.textContent === "Copy link");
    assert.ok(item, `the ${tab.textContent} tab offers Copy link`);
    await act(async () => item.click());
    act(() => roots.pop()?.unmount());
    container.remove();
  }

  assert.deepEqual(
    copied,
    cases.map(([, , link]) => link),
  );
});
