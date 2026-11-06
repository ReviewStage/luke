// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE, PULL_REQUEST_PART } from "@repo/features/agent-view";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { pageFrameUrl } from "@repo/features/page-frame";
import type { Task } from "@repo/features/task-wire";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import {
  agentTab,
  changesTab,
  draftTab,
  fileTab,
  pageTab,
  subagentTab,
  terminalTab,
} from "@repo/ui/tab-strip-model";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { AgentsControl } from "../tasks/use-agents.js";
import { MAIN_TAB, type MainTab } from "../tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import {
  DESKTOP_CAPABILITIES,
  handCapabilities,
  handHostReads,
  holdPullRequestParts,
  registryWith,
} from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { onSideBundles, unlandedBundles } from "../testing/side-bundles.js";
import { agentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
// Note that a Pull request tab is loaded as the side panel loads it, on first use
// (`pages-on-demand.ts`), so the module is read here first and its load settles
// within the test's own ticks.
import "../tasks/agent-pull-request-tab.js";
import { openTaskMenu } from "../testing/task-menu.js";
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
 * its body hands up, Open on GitHub and Refresh, which no other tab's offers.
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

/** The agent's cloud terminal tab. */
const CLOUD = terminalTab(AGENT.id, "2f6e0c1a-5b3d-4c8e-9a1f-7d2b4e6a8c10", "Cloud 1");

const PAGE_ID = "5d2b7c1e-9a3f-4e6d-8c2b-1f0e9d8c7b6a";

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  handCapabilities(DESKTOP_CAPABILITIES, experimentsOn(EXPERIMENT.DESCRIPTIONS));
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The agent's delegated worker, whose tab the side panel holds. */
const SUBAGENT = subagentTab("call-1", { agent: AGENT.id, task: "Audit retries" });

/** What a right-click offers on a tab itself rather than on what it shows. */
const TAB_KEEPING = new Set([
  "Close",
  "Close others",
  "Pin tab",
  "Unpin tab",
  "Pin agent",
  "Unpin agent",
  "Move left",
  "Move right",
]);

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
      tabs: [MAIN_TAB.OVERVIEW, agentTab(AGENT.id), draftTab("draft-1")],
      tab: chosen.main,
      openAgents: [AGENT.id],
    },
    sidePanel: {
      ...tasksControl().sidePanel,
      open: true,
      subagents: [SUBAGENT],
      files: [{ path: "src/invite.ts", range: undefined, opened: 1, browsedOn: TASK.id }],
      changes: [changesTab(AGENT.id)],
      terminals: [CLOUD],
      pages: [pageTab(PAGE_ID)],
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
  // The host holds the Pull request tab's parts, answered as a service that did not answer.
  const unanswered = () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED } as const);
  holdPullRequestParts(handHostReads({}).deliverParts, {
    [PULL_REQUEST_PART.PULL_REQUEST]: unanswered,
    [PULL_REQUEST_PART.CHECKS]: unanswered,
    [PULL_REQUEST_PART.CONVERSATION]: unanswered,
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS)),
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
      `${item.querySelector(".ui-menu-item-label")?.textContent}${item.disabled ? " (off)" : ""}`,
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

/** The bars of the task's page: the task's topbar, and under it its column's agents' bar and the side panel's. */
interface Bars {
  task: HTMLElement;
  main: HTMLElement;
  side: HTMLElement;
}

/** The bars of the task's page, as it draws them. */
function bars(container: HTMLElement): Bars {
  const task = container.querySelector<HTMLElement>(".task-topbar .ui-toolbar");
  const main = container.querySelector<HTMLElement>(".desktop-task-main .ui-toolbar");
  const side = container.querySelector<HTMLElement>(".side-panel-bar");
  assert.ok(task && main && side, "the page draws its bars");
  return { task, main, side };
}

/** What the right-click of the chosen tab of `strip` offers on what the tab shows, its own keeping left out. */
function contentOf(items: readonly string[]): string[] {
  return items.filter((item) => !TAB_KEEPING.has(item.replace(" (off)", "")));
}

/** Every ⋯ a bar draws, by its name. */
function moreButtons(bar: HTMLElement): (string | null)[] {
  return [...bar.querySelectorAll('button[aria-label$="actions"]')].map((button) =>
    button.getAttribute("aria-label"),
  );
}

test("a subagent's tab's right-click leads with the tab's keeping and then what it offers on what it shows, and an agent's tab in the column's bar with the agent's one menu", async () => {
  const container = await mountEveryTab({ main: agentTab(AGENT.id), side: SUBAGENT });
  const { main, side } = bars(container);
  const fromRightClick = rightClickChosen(side);
  assert.deepEqual(contentOf(fromRightClick), ["Copy link", "Copy transcript"]);
  assert.ok(
    fromRightClick.includes("Close others") || fromRightClick.includes("Close others (off)"),
  );

  const agentItems = rightClickChosen(main);
  assert.deepEqual(agentItems, [
    "Move right",
    "Close",
    "Close others",
    "Pin agent",
    "Copy link",
    "Copy transcript",
    "Rename",
    "Show terminal",
    "Archive",
    "Permanently delete",
  ]);
  assert.ok(!agentItems.includes("Mark done"), "none of the task's");
});

test("no bar of the task's page draws a ⋯, over an agent's tab or the draft's: every menu there is a right-click", async () => {
  for (const main of [agentTab(AGENT.id), draftTab("draft-1")] as const) {
    const container = await mountEveryTab({ main, side: SUBAGENT });
    const { task, main: agentsBar, side } = bars(container);
    for (const bar of [task, agentsBar, side]) {
      assert.deepEqual(moreButtons(bar), [], `no ⋯ beside ${JSON.stringify(main)}`);
    }
    act(() => roots.pop()?.unmount());
    container.remove();
  }
});

test("the task's name's right-click is the task's own document menu, which pins the task, leaves out Mark done and Cancel task, and keeps Change repository, on the task's details and an agent's tab alike, while an agent's tab's right-click stays the agent's", async () => {
  const taskMenu = (container: HTMLElement) => {
    openTaskMenu(container);
    return readAndClose();
  };
  const details = await mountEveryTab({ main: MAIN_TAB.OVERVIEW, side: SIDE_PANEL_TAB.INBOX });
  const fromDetails = taskMenu(details);
  assert.deepEqual(fromDetails, [
    "Copy description",
    "Copy link",
    "Rename",
    "Version history",
    "Mark as unread",
    "Task relation",
    "Pin",
    "Move to",
    "Change repository",
    "Permanently delete",
  ]);
  act(() => roots.pop()?.unmount());
  details.remove();

  const agent = await mountEveryTab({ main: agentTab(AGENT.id), side: SIDE_PANEL_TAB.INBOX });
  assert.deepEqual(taskMenu(agent), fromDetails, "the same menu over an agent's tab");
  const agentItems = rightClickChosen(bars(agent).main);
  assert.ok(
    !agentItems.includes("Copy description") && !agentItems.includes("Version history"),
    "an agent's tab offers none of the task's items",
  );
});

test("a tab with nothing to offer on what it shows still answers a right-click with its own keeping, and no tab wears a ⋯ of its own", async () => {
  const without: { main: MainTab; side: SidePanelTab }[] = [
    { main: draftTab("draft-1"), side: fileTab("src/invite.ts") },
    { main: draftTab("draft-1"), side: CLOUD },
  ];
  for (const chosen of without) {
    const container = await mountEveryTab(chosen);
    const { main, side } = bars(container);
    for (const bar of [main, side]) {
      const label = bar.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
      assert.ok(rightClickChosen(bar).length > 0, `the ${label} tab answers a right-click`);
    }
    assert.equal(container.querySelector(".ui-tab [aria-haspopup]"), null, "no tab wears a ⋯");
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

test("the Pull request tab's right-click offers Copy link first, then Copy GitHub link, Open on GitHub, and Refresh, which no other tab of the panel offers, and opens the pull request on GitHub", async () => {
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
    { main: draftTab("draft-1"), side: changesTab(AGENT.id) },
    published,
  );
  const { side } = bars(container);
  // Note that the pull request's actions stand once its read reaches its query.
  await vi.waitFor(() =>
    assert.deepEqual(contentOf(rightClickChosen(side)), [
      "Copy link",
      "Copy GitHub link",
      "Open on GitHub",
      "Refresh",
    ]),
  );
  const tab = side.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  act(() => {
    tab?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const github = [
    ...(openMenu()?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ].find((each) => each.querySelector(".ui-menu-item-label")?.textContent === "Open on GitHub");
  assert.ok(github, "the right-click offers Open on GitHub");
  await act(async () => github.click());
  assert.deepEqual(opened, [PULL_REQUEST.url]);
  act(() => roots.pop()?.unmount());
  container.remove();

  for (const other of [SUBAGENT, pageTab(PAGE_ID)] as const) {
    const each = await mountEveryTab({ main: draftTab("draft-1"), side: other }, published);
    const items = rightClickChosen(bars(each).side);
    assert.ok(
      !items.includes("Open on GitHub") && !items.includes("Refresh"),
      `the ${JSON.stringify(other)} tab offers neither Open on GitHub nor Refresh`,
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

test("each tab whose thing has a link offers Copy link in its right-click and its bar's ⋯, copying the agent's, its worker's, its Changes', or a page's", async () => {
  const copied = installClipboard();
  const task = `https://vespin.dev/workspace-personal/task/${TASK.id}`;
  const agent = `https://vespin.dev/workspace-personal/agent/${AGENT.id}`;
  const cases: [{ main: MainTab; side: SidePanelTab }, keyof Bars, string][] = [
    [{ main: agentTab(AGENT.id), side: SIDE_PANEL_TAB.INBOX }, "main", agent],
    [{ main: draftTab("draft-1"), side: SUBAGENT }, "side", `${agent}/worker/call-1`],
    [{ main: draftTab("draft-1"), side: changesTab(AGENT.id) }, "side", `${agent}/changes`],
    [{ main: draftTab("draft-1"), side: pageTab(PAGE_ID) }, "side", `${task}/page/${PAGE_ID}`],
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
