// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { pageFrameUrl } from "@repo/features/page-frame";
import type { Task } from "@repo/features/task-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import { useTaskRenameOffer } from "../tasks/task-menu-items.js";
import { MAIN_TAB } from "../tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { agentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";
import { TASK_PANE, taskPaneOf } from "./task-pane-switcher.js";

/**
 * task-pane-switcher.test.ts -- a phone's task is headed by one row, the way back, the title of what is on screen, and one ⋯ of what is on screen: Overview leads out of the task and offers the task's own menu; an agent's screen, a draft's, and a tab of the panel are pushed over it, each going back a screen, named for where it goes, titled by what it shows, and its ⋯ the agent's, Discard draft, or the tab's, unnamed under each item since the row names it; and a wide window keeps its strip and toolbar, Overview's ⋯ renaming the task in the plan's own title.
 */

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "", assumptions: [] },
};

/** An agent of the task, whose tab the column shows on the Agents view. */
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

/** The draft's tab, a New agent not yet started. */
const DRAFT = { draft: "draft" } as const;

/** A page an agent showed on the plan, whose tab offers a link to itself. */
const PAGE = {
  id: "5d0c1f2e-7a3b-4c9d-8e1f-2a3b4c5d6e7f",
  title: "Invite funnel",
  version: 1,
  at: 1,
};

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform({ ...QUIET_PANEL, pageFrameUrl });
  fakeAppBridge({});
  handState({});
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

test("the screen standing follows the column and the panel: a tab of the panel while it is open, else Overview on the task's Overview and the agent's on an agent's tab", () => {
  assert.equal(taskPaneOf({ open: true, column: MAIN_TAB.OVERVIEW }), TASK_PANE.PANEL);
  assert.equal(taskPaneOf({ open: false, column: MAIN_TAB.OVERVIEW }), TASK_PANE.OVERVIEW);
  assert.equal(taskPaneOf({ open: false, column: { agent: AGENT.id } }), TASK_PANE.AGENT);
  assert.equal(taskPaneOf({ open: false, column: { draft: "draft" } }), TASK_PANE.AGENT);
});

/** The task's page in `room`, its panel open on `tab` over the plan, the Inbox, and the comments, a page of the plan's where `paged`, and its column on the agent's tab where `agent`, every press on the panel, the way out, and a rename told; `draw` draws it again over a panel opened or shut on another tab. */
/** What a menu item says, its words and what it acts on, without the chord the open task's items print at their end. */
function itemWords(item: HTMLElement): string {
  const chord = item.querySelector(".ui-shortcut")?.textContent ?? "";
  const words = item.textContent ?? "";
  return chord !== "" && words.endsWith(chord) ? words.slice(0, -chord.length) : words;
}

function mount(
  room: ShellRoom,
  open = false,
  tab: SidePanelTab | undefined = SIDE_PANEL_TAB.COMMENTS,
  paged = false,
  agent = false,
  held: readonly AgentSummary[] = [AGENT],
  draft = false,
) {
  const told: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const narrow = room === SHELL_ROOM.NARROW;
  const registry = AtomRegistry.make();
  /** The rename door the open task's page offers ⌘K, as it stood at the last draw. */
  let renameOffer: ReturnType<typeof useTaskRenameOffer>;
  function RenameOfferProbe(): null {
    renameOffer = useTaskRenameOffer();
    return null;
  }
  const draw = (
    shown: boolean,
    on: SidePanelTab | undefined,
    repositoryAsk?: number,
    onAgent = agent,
  ) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          // Note that the shell hands its room to every tab's body, as the window's root does.
          createElement(
            ShellRoomContext.Provider,
            { value: room },
            createElement(RenameOfferProbe),
            createElement(DesktopTasks, {
              summary: UNPINNED_SUMMARY,
              looks: NO_LOOKS,
              room,
              away: { label: "Inbox", onPress: () => told.push("away") },
              tasks: tasksControl({
                page: TASKS_PAGE.DOCUMENT,
                activeTaskId: TASK.id,
                region: { kind: DOCUMENT_REGION.READY, task: TASK },
                pages: paged ? [PAGE] : undefined,
                onRenameTask: (taskId, name) => {
                  told.push(`rename ${taskId} ${name}`);
                  return Promise.resolve(true);
                },
                repositoryMenu:
                  repositoryAsk === undefined
                    ? undefined
                    : { taskId: TASK.id, request: repositoryAsk },
                mainTabs: {
                  ...tasksControl().mainTabs,
                  tabs: [MAIN_TAB.OVERVIEW, { agent: AGENT.id }, ...(draft ? [DRAFT] : [])],
                  tab: draft ? DRAFT : onAgent ? { agent: AGENT.id } : MAIN_TAB.OVERVIEW,
                  openAgents: [AGENT.id],
                  onChoose: (chosen) => told.push(`column ${JSON.stringify(chosen)}`),
                  onClose: (closed) => told.push(`close column ${JSON.stringify(closed)}`),
                },
                agents: agentsControl({
                  agents: [...held],
                  agentIds: held.map((each) => each.id),
                  onDiscardDraft: (draftId) => told.push(`discard ${draftId}`),
                }),
                sidePanel: {
                  ...tasksControl().sidePanel,
                  open: shown,
                  fullScreen: shown && narrow,
                  fullScreenOnly: shown && narrow,
                  tabs: [SIDE_PANEL_TAB.INBOX, SIDE_PANEL_TAB.COMMENTS],
                  strip: [SIDE_PANEL_TAB.INBOX, SIDE_PANEL_TAB.COMMENTS],
                  pages: paged ? [{ page: PAGE.id }] : [],
                  tab: on,
                  onChoose: (chosen) =>
                    told.push(
                      `choose ${typeof chosen === "string" ? chosen : JSON.stringify(chosen)}`,
                    ),
                  onToggle: () => told.push("toggle"),
                  onShowList: () => told.push("list"),
                  onClose: (closed) => told.push(`close ${String(closed)}`),
                },
              }),
            }),
          ),
        ),
      ),
    );
  draw(open, tab);
  // The row's ⋯, named for what is on screen ("Agent actions").
  const more = () => {
    const found = container.querySelector<HTMLButtonElement>(
      '.task-head .ui-toolbar-actions button[aria-haspopup="menu"]',
    );
    assert.ok(found, "the row holds its ⋯");
    return found;
  };
  // The ⋯'s menu, opened to be read and closed again by the press that opened it.
  const menu = () => {
    act(() => more().click());
    const groups = [...document.querySelectorAll<HTMLElement>('[role="menu"] button')].map((each) =>
      itemWords(each),
    );
    act(() => more().click());
    return groups;
  };
  const choose = (name: string) => {
    act(() => more().click());
    const found = [...document.querySelectorAll<HTMLElement>('[role="menu"] button')].find(
      (each) => itemWords(each) === name,
    );
    assert.ok(found, `the ⋯ offers ${name}`);
    act(() => found.click());
  };
  const head = () => ({
    buttons: [...container.querySelectorAll(".task-head button")].map(
      (each) => each.getAttribute("aria-label") ?? each.textContent,
    ),
    title: container.querySelector(".task-head h1")?.textContent,
  });
  const back = () => {
    const found = container.querySelector<HTMLButtonElement>(".task-head .ui-toolbar-lead button");
    assert.ok(found, "the row leads with its way back");
    act(() => found.click());
  };
  const labelled = (label: string) =>
    [...container.querySelectorAll("button")].some(
      (each) => each.getAttribute("aria-label") === label,
    );
  /** Asks the rename ⌘K would, through the door the page offers it. */
  const renameFromPalette = () => {
    assert.ok(renameOffer, "the page offers ⌘K its rename");
    act(() => renameOffer?.begin());
  };
  return {
    container,
    told,
    menu,
    choose,
    head,
    back,
    draw,
    labelled,
    renameFromPalette,
  };
}

test("on a phone Overview is headed by the way out of the task and one ⋯ of the task's own actions, naming the task in its plan's heading alone", () => {
  const page = mount(SHELL_ROOM.NARROW);
  assert.deepEqual(page.head(), { buttons: ["Inbox", "Task actions"], title: undefined });
  const menu = page.menu();
  assert.ok(menu.includes("Rename") && menu.includes("Permanently delete"), "the task's own");
  assert.equal(page.labelled("Title actions"), false, "the plan's title draws no second ⋯");
  assert.equal(page.labelled(`${TASK.name} actions`), false, "the column draws no ⋯ of Overview's");

  page.back();
  assert.deepEqual(page.told, ["away"], "the way back goes where the shell says, pushing nothing");
});

test("on a phone an agent's screen goes back to Overview, is titled by the agent, and its ⋯ is the agent's, Show browser beside Show terminal, unnamed under each item", () => {
  const page = mount(SHELL_ROOM.NARROW, false, undefined, false, true);
  assert.deepEqual(page.head(), {
    buttons: ["Back to Overview", "Agent actions"],
    title: AGENT.title,
  });
  const menu = page.menu();
  assert.ok(menu.includes("Copy link") && menu.includes("Copy concise transcript"));
  assert.ok(menu.includes("Show browser"), "the agent's browser, which no list of tabs offers");
  assert.ok(!menu.includes("Copy plan"), "none of the task's own");

  page.choose("Show browser");
  assert.ok(
    page.told.some((each) => each.startsWith("choose ") && each.includes("cloudBrowser")),
    "a tab of the agent's browser opens in the panel",
  );
  page.back();
  assert.equal(page.told.at(-1), `column "${MAIN_TAB.OVERVIEW}"`);
});

test("on a phone a draft's screen is titled New agent, and its ⋯ discards it as the strip's close did", () => {
  const page = mount(SHELL_ROOM.NARROW, false, undefined, false, false, [AGENT], true);
  assert.deepEqual(page.head(), {
    buttons: ["Back to Overview", "Agent actions"],
    title: "New agent",
  });
  assert.deepEqual(page.menu(), ["Find", "Discard draft"]);

  page.choose("Discard draft");
  assert.deepEqual(page.told, [`close column ${JSON.stringify(DRAFT)}`, `discard ${DRAFT.draft}`]);
});

test("on a phone ⌘T starts New agent at once, the panel shut over it, since no + stands in sight", () => {
  const page = mount(SHELL_ROOM.NARROW, true, SIDE_PANEL_TAB.COMMENTS);
  act(() => {
    runAppCommand(APP_COMMAND.NEW_TAB);
  });
  assert.deepEqual(page.told, ["toggle", `column ${JSON.stringify(DRAFT)}`]);
});

test("on a phone a tab of the panel is pushed over the column, titled by the tab, going back shutting the panel, its ⋯ the tab's own", () => {
  const page = mount(SHELL_ROOM.NARROW, true, { page: PAGE.id }, true);
  assert.deepEqual(page.head(), {
    buttons: ["Back to Overview", "Tab actions"],
    title: PAGE.title,
  });
  const menu = page.menu();
  assert.ok(menu.includes("Copy link"), "the tab's own");
  assert.ok(!menu.includes("Copy plan"), "the task's own menu is Overview's");

  page.back();
  assert.deepEqual(page.told, ["toggle"]);
});

test("on a phone ⌘K's Change repository shows Overview from under the panel, and opens the repository's menu under the plan's path only once the plan is in sight", async () => {
  const page = mount(SHELL_ROOM.NARROW, true);
  page.draw(true, SIDE_PANEL_TAB.COMMENTS, 1);
  await act(async () => undefined);
  assert.deepEqual(page.told, [`column "${MAIN_TAB.OVERVIEW}"`], "Overview is shown");
  page.draw(false, SIDE_PANEL_TAB.COMMENTS, 1);
  await act(async () => undefined);
  assert.ok(
    page.container.querySelector('.plan-task-path [role="dialog"][aria-label="Repository"]'),
    "the repository's menu opens for the ask",
  );
});

test("on a phone the ⋯'s Rename edits the task's name in the row's title", async () => {
  const page = mount(SHELL_ROOM.NARROW);
  page.choose("Rename");
  const field = page.container.querySelector<HTMLInputElement>(
    '.task-head input[aria-label="Task name"]',
  );
  assert.ok(field, "the title is the name's field");
  field.value = "Invite teammates";
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.deepEqual(page.told, [`rename ${TASK.id} Invite teammates`]);
});

test("on a phone, which has no ⌘F to press, Overview's ⋯ Find opens the find bar over the plan with the caret in its field", () => {
  const page = mount(SHELL_ROOM.NARROW);
  page.choose("Find");
  const field = page.container.querySelector<HTMLInputElement>(
    '.find-bar input[aria-label="Find"]',
  );
  assert.ok(field, "the plan's find bar stands");
  assert.equal(document.activeElement, field);
});

test("a wide window keeps the panel's strip and the column's toolbar, the task's ⋯ Overview's, and draws no row of a phone's", () => {
  const page = mount(SHELL_ROOM.WIDE, true);
  assert.equal(page.container.querySelector(".task-head"), null);
  assert.ok(page.container.querySelector(".side-panel-tabs"), "the panel keeps its strip");
  assert.ok(page.labelled(`${TASK.name} actions`), "the task's first tab keeps the task's ⋯");
  assert.equal(page.labelled("Task actions"), false, "the column's toolbar draws none");
});

test("on a phone a task still read, or one that cannot be, is headed by its way back alone, as the task's own head will lead", () => {
  for (const region of [
    { kind: DOCUMENT_REGION.READING },
    { kind: DOCUMENT_REGION.FAILED },
  ] as const) {
    const told: string[] = [];
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(DesktopTasks, {
            summary: UNPINNED_SUMMARY,
            looks: NO_LOOKS,
            room: SHELL_ROOM.NARROW,
            away: { label: "Inbox", onPress: () => told.push("away") },
            tasks: tasksControl({ page: TASKS_PAGE.DOCUMENT, region }),
          }),
        ),
      ),
    );
    const head = container.querySelector<HTMLElement>(".task-head");
    assert.ok(head, `a ${region.kind} task is headed`);
    assert.deepEqual(
      [...head.querySelectorAll("button")].map(
        (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
      ),
      ["Inbox"],
    );
    act(() => head.querySelector("button")?.click());
    assert.deepEqual(told, ["away"]);
    act(() => root.unmount());
    container.remove();
  }
});

test("on a phone a tab draws no bar of its own, and the task's header's ⋯ offers each of its controls by name, a press there acting as the bar's did", async () => {
  const page = mount(SHELL_ROOM.NARROW, true, { page: PAGE.id }, true);
  await act(async () => undefined);
  assert.equal(page.container.querySelector(".page-view .file-view-bar"), null);
  const menu = page.menu();
  assert.ok(menu.includes("View source"), "View source, named as the bar named it");
  assert.ok(menu.includes("Reload page"));

  page.choose("View source");
  await act(async () => undefined);
  assert.ok(page.menu().includes("View page"), "the source is shown");
});

/** Chooses Rename from Overview's ⋯ in a wide window's column. */
function chooseOverviewRename(container: HTMLElement): void {
  const more = container.querySelector<HTMLButtonElement>(
    ".desktop-task-main .toolbar-tab-actions button",
  );
  assert.ok(more, "Overview holds the task's ⋯");
  act(() => more.click());
  const rename = [...document.querySelectorAll<HTMLElement>('[role="menu"] button')].find(
    (each) => itemWords(each) === "Rename",
  );
  assert.ok(rename, "the ⋯ offers Rename");
  act(() => rename.click());
}

/** The plan's own title, which a wide window renames the task in. */
function planTitle(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="textbox"][aria-label="Task name"]');
}

test("on a wide window Overview's ⋯ › Rename puts the caret in the plan's own title, and draws no phone's field", () => {
  const page = mount(SHELL_ROOM.WIDE);
  chooseOverviewRename(page.container);

  assert.ok(planTitle(page.container), "the plan's title is drawn");
  assert.ok(
    document.activeElement === planTitle(page.container),
    "the caret is in the plan's title",
  );
  assert.equal(page.container.querySelector('input[aria-label="Task name"]'), null);
});

test("on a wide window whose column shows an agent, the rename ⌘K asks shows Overview and puts the caret in the plan's title once it stands", () => {
  const page = mount(SHELL_ROOM.WIDE, false, undefined, false, true);
  page.renameFromPalette();
  assert.deepEqual(page.told, [`column "${MAIN_TAB.OVERVIEW}"`]);

  page.draw(false, undefined, undefined, false);

  assert.ok(
    document.activeElement === planTitle(page.container),
    "the caret is in the plan's title",
  );
});

/** A wide window's task whose renames are all refused, its name drawn as the title's words are typed, as the window draws a draft. */
function RefusingTask(): React.JSX.Element {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const task = { ...TASK, name: draft ?? TASK.name };
  return createElement(DesktopTasks, {
    summary: UNPINNED_SUMMARY,
    looks: NO_LOOKS,
    room: SHELL_ROOM.WIDE,
    tasks: tasksControl({
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK.id,
      region: { kind: DOCUMENT_REGION.READY, task },
      onDraftName: (_taskId, name) => setDraft(name),
      onRenameTask: () => Promise.resolve(false),
    }),
  });
}

test("on a wide window a refused rename keeps the name typed in the plan's title, with the refusal beside it", async () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(RefusingTask))));
  const title = planTitle(container);
  assert.ok(title, "the plan's title is drawn");

  act(() => {
    title.focus();
    title.textContent = "Invite teammates";
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => title.blur());

  assert.equal(planTitle(container)?.textContent, "Invite teammates");
  assert.match(container.textContent ?? "", /The task could not be renamed\. Try again\./u);
});
