// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { pageFrameUrl } from "@luke/features/page-frame";
import type { Task } from "@luke/features/task-wire";
import { MAIN_TAB, type MainTab } from "@luke/panel/tasks/use-main-tabs";
import { NO_LOOKS } from "@luke/panel/tasks/use-task-looks";
import { DESKTOP_CAPABILITIES, handCapabilities } from "@luke/panel/testing/app-state";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "#testing/app-platform";
import { onSideBundles, unlandedBundles } from "#testing/side-bundles";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "#testing/tasks-control";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel";
import { DesktopTasks } from "./desktop-tasks";

/**
 * tab-actions.test.ts -- a column's bar holds a ⋯ for its chosen tab's
 * content actions: the task's own menu on the task's tab, and on an agent's
 * or a subagent's tab the actions its right-click offers on what it shows,
 * without the tab's own keeping (Close, Close others, Pin tab), which stays
 * on the right-click alone. A tab with no content action shows no ⋯, and no
 * tab wears one of its own.
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

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite expiry job",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
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
const TAB_KEEPING = new Set(["Close", "Close others", "Pin tab", "Unpin tab"]);

/** Waits out the few microtasks the window's document takes to arrive after the first draw. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * The task's page with a tab of every kind open, `main` chosen in its column
 * and `side` in the side panel: the task's, an agent's, the draft's, and the
 * Inbox's in the column, and in the side panel the fixed tabs, the agent's
 * delegated worker's, a file's, the agent's Changes and Terminal, and a page's.
 */
async function mountEveryTab(chosen: { main: MainTab; side: SidePanelTab }): Promise<HTMLElement> {
  const control = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    mainTabs: {
      ...tasksControl().mainTabs,
      tabs: [MAIN_TAB.PLAN, { agent: AGENT.id }, { draft: "draft-1" }, MAIN_TAB.INBOX],
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
    agents: codingAgentsControl({
      agents: [AGENT],
      agentIds: [AGENT.id],
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
            captions: undefined,
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
  const main = container.querySelector<HTMLElement>(".desktop-task-main .desktop-toolbar");
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

test("an agent's tab and a subagent's put their right-click's content actions, and none of the tab's keeping, behind their bar's ⋯", async () => {
  const container = await mountEveryTab({ main: { agent: AGENT.id }, side: SUBAGENT });
  const { main, side } = bars(container);
  for (const [bar, expected] of [
    [
      main,
      [
        "Rename",
        "Open terminal",
        "Run",
        "Copy link",
        "Copy concise transcript",
        "Copy full transcript",
        "Archive agent",
      ],
    ],
    [side, ["Copy link", "Copy concise transcript", "Copy full transcript"]],
  ] as const) {
    const fromRightClick = rightClickChosen(bar);
    const fromMore = pressBarMore(bar);
    assert.deepEqual(fromMore, expected);
    // The same items as the right-click's, less the tab's own keeping, which stays there.
    assert.deepEqual(
      fromMore,
      fromRightClick.filter((item) => !TAB_KEEPING.has(item.replace(" (off)", ""))),
    );
    assert.ok(
      fromRightClick.includes("Close others") || fromRightClick.includes("Close others (off)"),
    );
  }
});

test("the plan's tab keeps the plan's own ⋯ in its bar", async () => {
  const container = await mountEveryTab({ main: MAIN_TAB.PLAN, side: SIDE_PANEL_TAB.BOARD });
  const [more, ...others] = slotButtons(bars(container).main);
  assert.equal(more?.getAttribute("aria-label"), "Task actions");
  assert.equal(others.length, 0);
});

test("a tab with no content action shows no ⋯ in its bar, though its right-click still answers, and no tab wears a ⋯ of its own", async () => {
  const without: { main: MainTab; side: SidePanelTab }[] = [
    { main: MAIN_TAB.INBOX, side: SIDE_PANEL_TAB.BOARD },
    { main: { draft: "draft-1" }, side: SIDE_PANEL_TAB.CODE },
    { main: MAIN_TAB.INBOX, side: { file: "src/invite.ts" } },
    { main: MAIN_TAB.INBOX, side: { terminal: AGENT.id } },
  ];
  for (const chosen of without) {
    const container = await mountEveryTab(chosen);
    const { main, side } = bars(container);
    for (const bar of [main, side]) {
      const label = bar.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
      assert.deepEqual(slotButtons(bar), [], `the ${label} tab shows no ⋯`);
      assert.ok(rightClickChosen(bar).length > 0, `the ${label} tab answers a right-click`);
    }
    assert.equal(container.querySelector(".tab [aria-haspopup]"), null, "no tab wears a ⋯");
    act(() => roots.pop()?.unmount());
    container.remove();
  }
});

/** Main's clipboard, keeping each copy the window asks of it. */
function installClipboard(): string[] {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied), pageFrameUrl });
  return copied;
}

test("each tab whose thing has a link offers Copy link in its right-click and its bar's ⋯, copying the task's, the agent's, its worker's, its Changes', a page's, or the Call tab's link", async () => {
  const copied = installClipboard();
  const task = `https://tryluke.dev/workspace-personal/plan/${TASK.id}`;
  const cases: [{ main: MainTab; side: SidePanelTab }, "main" | "side", string][] = [
    [{ main: MAIN_TAB.PLAN, side: SIDE_PANEL_TAB.BOARD }, "main", task],
    [
      { main: { agent: AGENT.id }, side: SIDE_PANEL_TAB.BOARD },
      "main",
      `${task}/agent/${AGENT.id}`,
    ],
    [{ main: MAIN_TAB.INBOX, side: SUBAGENT }, "side", `${task}/agent/${AGENT.id}/worker/call-1`],
    [
      { main: MAIN_TAB.INBOX, side: { changes: AGENT.id } },
      "side",
      `${task}/agent/${AGENT.id}/changes`,
    ],
    [{ main: MAIN_TAB.INBOX, side: { page: PAGE_ID } }, "side", `${task}/page/${PAGE_ID}`],
    [{ main: MAIN_TAB.INBOX, side: SIDE_PANEL_TAB.CALL }, "side", `${task}/call`],
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
