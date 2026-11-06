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
import "../tasks/agent-pull-request-tab.js";
import { openTaskMenu } from "../testing/task-menu.js";
import { DesktopTasks } from "./desktop-tasks.js";

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
  handCapabilities(DESKTOP_CAPABILITIES, experimentsOn(EXPERIMENT.DESCRIPTIONS));
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const SUBAGENT = { subagent: "call-1", delegation: { agent: AGENT.id, task: "Audit retries" } };

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

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

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
      tabs: [MAIN_TAB.OVERVIEW, { agent: AGENT.id }, { draft: "draft-1" }],
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

function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
}

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

interface Bars {
  task: HTMLElement;
  main: HTMLElement;
  side: HTMLElement;
}

function bars(container: HTMLElement): Bars {
  const task = container.querySelector<HTMLElement>(".task-topbar .ui-toolbar");
  const main = container.querySelector<HTMLElement>(".desktop-task-main .ui-toolbar");
  const side = container.querySelector<HTMLElement>(".side-panel-bar");
  assert.ok(task && main && side, "the page draws its bars");
  return { task, main, side };
}

function contentOf(items: readonly string[]): string[] {
  return items.filter((item) => !TAB_KEEPING.has(item.replace(" (off)", "")));
}

function moreButtons(bar: HTMLElement): (string | null)[] {
  return [...bar.querySelectorAll('button[aria-label$="actions"]')].map((button) =>
    button.getAttribute("aria-label"),
  );
}

test("a subagent's tab's right-click leads with the tab's keeping and then what it offers on what it shows, and an agent's tab in the column's bar with the agent's one menu", async () => {
  const container = await mountEveryTab({ main: { agent: AGENT.id }, side: SUBAGENT });
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
  for (const main of [{ agent: AGENT.id }, { draft: "draft-1" }] as const) {
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

  const agent = await mountEveryTab({ main: { agent: AGENT.id }, side: SIDE_PANEL_TAB.INBOX });
  assert.deepEqual(taskMenu(agent), fromDetails, "the same menu over an agent's tab");
  const agentItems = rightClickChosen(bars(agent).main);
  assert.ok(
    !agentItems.includes("Copy description") && !agentItems.includes("Version history"),
    "an agent's tab offers none of the task's items",
  );
});

test("a tab with nothing to offer on what it shows still answers a right-click with its own keeping, and no tab wears a ⋯ of its own", async () => {
  const without: { main: MainTab; side: SidePanelTab }[] = [
    { main: { draft: "draft-1" }, side: { file: "src/invite.ts" } },
    { main: { draft: "draft-1" }, side: { terminal: AGENT.id } },
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
    { main: { draft: "draft-1" }, side: { changes: AGENT.id } },
    published,
  );
  const { side } = bars(container);
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

  for (const other of [SUBAGENT, { page: PAGE_ID }] as const) {
    const each = await mountEveryTab({ main: { draft: "draft-1" }, side: other }, published);
    const items = rightClickChosen(bars(each).side);
    assert.ok(
      !items.includes("Open on GitHub") && !items.includes("Refresh"),
      `the ${JSON.stringify(other)} tab offers neither Open on GitHub nor Refresh`,
    );
    act(() => roots.pop()?.unmount());
    each.remove();
  }
});

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
    [{ main: { agent: AGENT.id }, side: SIDE_PANEL_TAB.INBOX }, "main", agent],
    [{ main: { draft: "draft-1" }, side: SUBAGENT }, "side", `${agent}/worker/call-1`],
    [{ main: { draft: "draft-1" }, side: { changes: AGENT.id } }, "side", `${agent}/changes`],
    [{ main: { draft: "draft-1" }, side: { page: PAGE_ID } }, "side", `${task}/page/${PAGE_ID}`],
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
