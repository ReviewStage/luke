// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { RUN_PROFILE } from "@luke/host/app-state";
import {
  ACCOUNT_ACT_KIND,
  AGENT_ACT_KIND,
  AGENT_INBOX_ACT_KIND,
  AUTOMATION_ACT_KIND,
  INTEGRATION_ACT_KIND,
  SETTINGS_ACT_KIND,
  TASKS_ACT_KIND,
  UPDATE_ACT_KIND,
  WINDOW_SURFACE_ACT_KIND,
} from "@luke/host/contract";
import { EXPERIMENT, HOST_CAPABILITY } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { NAV_COUNT_TONE } from "@luke/ui";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_GRANTOR, NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { useAct } from "../act.js";
import { appBridge } from "../app-bridge.js";
import { runAppCommand } from "../app-commands.js";
import { CallCardContext, type CallCardInput, callControls } from "../call/call-card.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import type { SettingsPanelProps } from "../settings/settings-panel.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { fixtureChat } from "../tasks/chat-fixture.js";
import { HISTORY_READ } from "../tasks/use-plan-history.js";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import {
  DESKTOP_CAPABILITIES,
  handCapabilities,
  handState,
  stateWith,
} from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_NAME, DOCUMENT_TASK } from "../testing/document-task.js";
import { restOn } from "../testing/hint-rest.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopShell } from "./desktop-shell.js";
import { SIDEBAR_OVERLAY, type SidebarCollapse } from "./sidebar-collapse.js";

const ignore = () => undefined;
const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
/** A signed-in account's Settings, every press ignored. */
const SETTINGS: SettingsPanelProps = {
  account: {
    status: ACCOUNT_STATUS.SIGNED_IN,
    email: "dev@example.com",
    name: "Dev",
    provider: "github",
  },
  onSignOut: () => Promise.resolve(),
  onDeleteAccount: accepted,
  view: SETTINGS_VIEW.ACCOUNT,
  onViewChange: ignore,
  microphone: {
    status: MICROPHONE_STATUS.GRANTED,
    voiceAvailable: true,
    onRequest: ignore,
    onOpenSettings: ignore,
  },
  notifications: {
    status: NOTIFICATIONS_STATUS.UNKNOWN,
    grantor: NOTIFICATIONS_GRANTOR.MACOS,
    packaged: true,
    onOpenSettings: ignore,
    onTest: ignore,
  },
  capabilities: DESKTOP_CAPABILITIES,
  updates: {
    update: {
      status: UPDATE_STATUS.IDLE,
      currentVersion: "1.0.0",
      installSupported: true,
      upToDate: false,
    },
    build: { packaged: false },
    onCheck: () => Promise.resolve(),
    onInstall: ignore,
    onOpenLatest: ignore,
  },
};

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  // The window's motion as a Mac with none reduced answers it.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({});
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The shell's props over `plans`, every other door ignored, the sidebar folded unless patched. */
function shellProps(
  tasks: TasksControl,
  tab: PanelTab,
  onTabChange: (tab: PanelTab) => void,
  sidebarPatch: Partial<SidebarCollapse>,
): Parameters<typeof DesktopShell>[0] {
  return {
    gates: {
      accountRequired: false,
      onBeginSignIn: ignore,
      onCancelSignIn: ignore,
    },
    tab,
    onTabChange,
    tasks: tasks,
    history: {
      canGoBack: false,
      canGoForward: false,
      onBack: ignore,
      onForward: ignore,
      steps: { back: [], forward: [] },
      onGoTo: ignore,
      onLeaveVersionHistory: ignore,
      away: undefined,
      onLeave: ignore,
    },
    sidebar: {
      collapsed: true,
      compact: false,
      overlay: SIDEBAR_OVERLAY.CLOSED,
      width: 264,
      onToggle: ignore,
      onOverlay: ignore,
      onResize: ignore,
      staged: false,
      ...sidebarPatch,
    },
    room: SHELL_ROOM.WIDE,
    settingsStep: { listed: true, onList: ignore },
    settings: SETTINGS,
  };
}

/**
 * The window's shell with no task open and the sidebar folded, the Inbox
 * open over it or not, New task opening its dialog and Cancel putting it
 * away as the tab does.
 */
function mount(
  inboxOpen: boolean,
  restoring = false,
  overrides: Partial<TasksControl> = {},
  tab: PanelTab = PANEL_TAB.TASKS,
  onTabChange: (tab: PanelTab) => void = ignore,
  sidebarPatch: Partial<SidebarCollapse> = {},
  registry = AtomRegistry.make(),
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const control = tasksControl();
  function Shell() {
    const [asked, setAsked] = useState(false);
    const tasks = tasksControl({
      page: TASKS_PAGE.HOME,
      restoring,
      inboxView: {
        open: inboxOpen,
        chosen: undefined,
        onOpen: ignore,
        onOpenList: () => undefined,
        onClose: ignore,
        onChoose: ignore,
        onOpenItem: () => undefined,
        listed: false,
        onListed: ignore,
        pages: undefined,
        onTaskAgents: () => undefined,
      },
      onNewTask: () => setAsked(true),
      newTask: { ...control.newTask, open: asked, onClose: () => setAsked(false) },
      ...overrides,
    });
    return createElement(DesktopShell, shellProps(tasks, tab, onTabChange, sidebarPatch));
  }
  act(() => root?.render(onRegistry(registry, createElement(Shell))));
  return container;
}

/** The buttons beside the traffic lights, by name. */
function titleBarButtons(page: HTMLElement): string[] {
  const controls = page.querySelector(".title-bar-controls:not([data-edge])");
  assert.ok(controls, "the title bar's buttons stand");
  return [...controls.querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? "",
  );
}

test("while Settings is still loading its frame stands, a page of placeholder sections beside the page list's column, and Escape pressed there leaves Settings for the plans, as it does once Settings stands", () => {
  const tabs: PanelTab[] = [];
  const page = mount(false, false, {}, PANEL_TAB.SETTINGS, (tab) => tabs.push(tab));
  const placeholder = page.querySelector('section[aria-label="Settings"] [role="status"]');

  assert.deepEqual(
    [
      page.querySelector('nav[aria-label="Settings pages"]') !== null,
      placeholder?.textContent,
      placeholder?.querySelectorAll(".luke-settings-section-card").length,
    ],
    [true, "Loading Settings", 1],
  );

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_SETTINGS), "Settings' way out is offered");
  });

  assert.deepEqual(tabs, [PANEL_TAB.TASKS]);
});

test("with the sidebar folded, New plan stands beside its toggle over the welcome and the Inbox alike", () => {
  assert.deepEqual(titleBarButtons(mount(false)), ["Show sidebar", "New task"]);
  act(() => root?.unmount());
  root = undefined;
  assert.deepEqual(titleBarButtons(mount(true)), ["Show sidebar", "New task"]);
});

test("the title bar's buttons, each wrapped in its hint, tell a reader the chord that reaches them on the button itself", () => {
  const controls = mount(false).querySelector(".title-bar-controls:not([data-edge])");
  assert.ok(controls, "the title bar's buttons stand");
  const chords = [...controls.querySelectorAll("button")].map((button) => [
    button.getAttribute("aria-label"),
    button.getAttribute("aria-keyshortcuts"),
  ]);
  assert.deepEqual(chords, [
    ["Show sidebar", "Meta+B"],
    ["New task", "Meta+N"],
  ]);
});

test("an account with no plan is welcomed on New task's composer, and the title bar's New task still raises the dialog over the window, which Escape puts away", () => {
  const page = mount(false);
  const welcome = page.querySelector('section[aria-label="Welcome"]');
  assert.ok(welcome, "the welcome stands");
  assert.ok(welcome.querySelector(".new-task-composer"), "the welcome holds New task's composer");
  const newTask = page.querySelector<HTMLButtonElement>(
    '.title-bar-controls:not([data-edge]) button[aria-label="New task"]',
  );
  assert.ok(newTask, "the title bar offers New task");
  act(() => newTask.click());
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  assert.equal(dialog?.querySelector("h2")?.textContent, "New task");
  act(() => {
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(
    document.querySelector('[role="dialog"][aria-modal="true"]') === null,
    true,
    "Escape puts the dialog away",
  );
});

test("while a launch reopens the plan last open, the column draws no welcome to flash before it", () => {
  const page = mount(false, true);
  assert.equal(page.querySelector('section[aria-label="Welcome"]'), null);
});

/** The sidebar's row named `name`: the button whose first words a reader hears are it. */
function rowNamed(within: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      [...button.children].find((part) => part.getAttribute("aria-hidden") !== "true")
        ?.textContent === name,
  );
}

/** The sidebar's row named `name`, where one stands. */
function placeRow(page: HTMLElement, name: string): HTMLButtonElement | undefined {
  return rowNamed(page.querySelector("aside.desktop-sidebar") ?? page, name);
}

test("the sidebar offers no Home row, the window resting on the Inbox with no task open", () => {
  const page = mount(false);
  assert.equal(placeRow(page, "Home"), undefined);
  assert.ok(placeRow(page, "Inbox"), "the Inbox's row stands");
});

const ACME: Workspace = {
  id: DOCUMENT_TASK.workspaceId,
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

test("the window is called by what stands in it: the plan on screen in its own workspace, else the Inbox, Automations, or Settings, and Luke once signed out", () => {
  const titled = (inboxOpen: boolean, tab: PanelTab, signedIn = true, workspaces = [ACME]) => {
    mount(
      inboxOpen,
      false,
      {
        signedIn,
        workspaces,
        workspace: ACME,
        region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
      },
      tab,
    );
    const title = document.title;
    act(() => root?.unmount());
    return title;
  };

  assert.deepEqual(
    [
      titled(false, PANEL_TAB.TASKS),
      titled(true, PANEL_TAB.TASKS),
      titled(false, PANEL_TAB.SETTINGS),
      titled(false, PANEL_TAB.TASKS, false),
      titled(false, PANEL_TAB.TASKS, true, [{ ...ACME, id: "workspace-other" }]),
    ],
    [`${DOCUMENT_NAME} — Acme`, "Inbox — Acme", "Settings", "Luke", DOCUMENT_NAME],
  );

  mount(false, false, {
    workspaces: [ACME],
    workspace: ACME,
    automationsView: { ...tasksControl().automationsView, open: true },
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
  });
  assert.equal(document.title, "Automations — Acme");
});

test("a plan opened with its Inbox tab shown rather than its plan is read at once, its row out of the unread weight, while the window's Inbox standing in its place leaves it unread", () => {
  const unreadOnOpen = (inboxOpen: boolean) => {
    window.localStorage.setItem("luke.planLooks", JSON.stringify({ [DOCUMENT_TASK.id]: 1 }));
    window.localStorage.setItem("luke.planLooksSeeded", "1");
    const page = mount(
      inboxOpen,
      false,
      {
        page: TASKS_PAGE.DOCUMENT,
        tasks: [DOCUMENT_TASK],
        activeTaskId: DOCUMENT_TASK.id,
        region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
        sidePanel: {
          ...tasksControl().sidePanel,
          open: true,
          tabs: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX],
          strip: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX],
          tab: SIDE_PANEL_TAB.INBOX,
        },
      },
      PANEL_TAB.TASKS,
      ignore,
      { collapsed: false },
    );
    const row = page.querySelector(".sidebar-tasks > li > button");
    assert.ok(row, "the plan's row stands in the sidebar");
    const unread = String(row.textContent?.includes("(unread)") === true);
    act(() => root?.unmount());
    window.localStorage.clear();
    return unread;
  };

  assert.equal(unreadOnOpen(false), "false");
  assert.equal(unreadOnOpen(true), "true");
});

/** A second plan beside `DOCUMENT_PLAN`, saved after it. */
const NOTES_TASK: Task = {
  ...DOCUMENT_TASK,
  id: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
  name: "Release notes",
  createdAt: 4,
  updatedAt: 5,
};

/**
 * The shell with the sidebar unfolded on `listed`, each looked at up to
 * the instant `looks` gives it, redrawn over whichever plan `open` names
 * next and the home page for none, the same shell throughout.
 */
function mountListing(
  listed: readonly Task[],
  looks: Readonly<Record<string, number>>,
): (open: Task | undefined) => void {
  window.localStorage.setItem("luke.taskLooks", JSON.stringify(looks));
  window.localStorage.setItem("luke.taskLooksSeeded", "1");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  return (open) => {
    const tasks = tasksControl({
      page: open === undefined ? TASKS_PAGE.HOME : TASKS_PAGE.DOCUMENT,
      tasks: listed.map((task) => (task.id === open?.id ? open : task)),
      activeTaskId: open?.id,
      region:
        open === undefined
          ? { kind: DOCUMENT_REGION.NONE }
          : { kind: DOCUMENT_REGION.READY, task: open },
    });
    const props = shellProps(tasks, PANEL_TAB.TASKS, ignore, { collapsed: false });
    act(() => root?.render(onRegistry(registry, createElement(DesktopShell, props))));
  };
}

/** The sidebar's row for the plan of this name. */
function sidebarRow(name: string): HTMLButtonElement {
  const row = [
    ...document.querySelectorAll<HTMLButtonElement>(".sidebar-tasks > li > button"),
  ].find((each) => each.querySelector(".luke-list-row-title")?.firstChild?.textContent === name);
  assert.ok(row, `the sidebar lists ${name}`);
  return row;
}

/** Whether the plan's row is drawn in the unread weight. */
function rowUnread(name: string): string | null {
  return String(sidebarRow(name).textContent?.includes("(unread)") === true);
}

/** The read mark the row's right-click menu offers, chosen when `choose` says so. */
function rowReadMark(name: string, choose = false): string | undefined {
  act(() => {
    sidebarRow(name).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  });
  const menu = document.querySelector('[role="menu"]');
  assert.ok(menu, `${name}'s menu opens`);
  const item = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((each) =>
    /^Mark as (un)?read$/u.test(each.textContent ?? ""),
  );
  act(() => {
    if (choose) item?.click();
    else menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(document.querySelector('[role="menu"]') === null, true, "the menu closes");
  return item?.textContent ?? undefined;
}

test("Mark as unread on the task being looked at draws its row unread through a save landing as it stays, and until it is opened again", () => {
  const draw = mountListing([DOCUMENT_TASK, NOTES_TASK], {
    [DOCUMENT_TASK.id]: DOCUMENT_TASK.updatedAt,
    [NOTES_TASK.id]: NOTES_TASK.updatedAt,
  });
  draw(DOCUMENT_TASK);
  assert.equal(rowUnread(DOCUMENT_NAME), "false");
  assert.equal(rowReadMark(DOCUMENT_NAME, true), "Mark as unread");
  assert.equal(rowUnread(DOCUMENT_NAME), "true");

  draw({ ...DOCUMENT_TASK, updatedAt: DOCUMENT_TASK.updatedAt + 1 });
  assert.equal(rowUnread(DOCUMENT_NAME), "true");

  draw(NOTES_TASK);
  assert.equal(rowUnread(DOCUMENT_NAME), "true");

  draw(DOCUMENT_TASK);
  assert.equal(rowUnread(DOCUMENT_NAME), "false");
});

test("a task's menu offers Mark as read while its row is unread, which draws it read, and Mark as unread after", () => {
  const draw = mountListing([DOCUMENT_TASK, NOTES_TASK], {
    [DOCUMENT_TASK.id]: DOCUMENT_TASK.updatedAt,
    [NOTES_TASK.id]: NOTES_TASK.updatedAt - 1,
  });
  draw(undefined);
  assert.equal(rowUnread(NOTES_TASK.name), "true");
  assert.equal(rowReadMark(DOCUMENT_NAME), "Mark as unread");

  assert.equal(rowReadMark(NOTES_TASK.name, true), "Mark as read");
  assert.equal(rowUnread(NOTES_TASK.name), "false");
  assert.equal(rowReadMark(NOTES_TASK.name), "Mark as unread");

  assert.equal(rowReadMark(NOTES_TASK.name, true), "Mark as unread");
  assert.equal(rowUnread(NOTES_TASK.name), "true");
  assert.equal(rowReadMark(NOTES_TASK.name), "Mark as read");
});

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("⌘/ is offered in the installed app, where Keyboard shortcuts is a page, and not in a browser, where it is none", async () => {
  handCapabilities(DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.DESKTOP_APP));
  mount(false);
  await settle();
  assert.equal(runAppCommand(APP_COMMAND.KEYBOARD_SHORTCUTS), false);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handCapabilities(DESKTOP_CAPABILITIES);
  mount(false);
  await settle();
  assert.equal(runAppCommand(APP_COMMAND.KEYBOARD_SHORTCUTS), true);
});

test("a press on the Automations row in a floating sidebar puts the sidebar away, as every row's does", async () => {
  const told: SidebarCollapse["overlay"][] = [];
  const page = mount(false, false, {}, PANEL_TAB.TASKS, ignore, {
    overlay: SIDEBAR_OVERLAY.OPEN,
    onOverlay: (next) => told.push(next),
  });
  await settle();
  const row = placeRow(page, "Automations");
  assert.ok(row);
  act(() => row.click());
  assert.deepEqual(told, [SIDEBAR_OVERLAY.CLOSED]);
});

test("the sidebar offers no Issues row, with every experiment on, since Luke keeps no issues of its own", async () => {
  handState(experimentsOn(...Object.values(EXPERIMENT)));
  const page = mount(false);
  await settle();
  assert.ok(placeRow(page, "Automations"));
  assert.equal(placeRow(page, "Issues"), undefined);
});

test("while the account has the inbox-first sidebar on, the sidebar lists the Inbox in its task list's place, its Inbox row gone, and the Tasks page's row stands either way", async () => {
  handState({});
  const off = mount(false);
  await settle();
  assert.ok(placeRow(off, "Tasks"));
  assert.equal(placeRow(off, "Board"), undefined);
  assert.ok(placeRow(off, "Inbox"));
  assert.equal(off.querySelector('aside .inbox-tasks[data-placement="sidebar"]'), null);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handState(experimentsOn(EXPERIMENT.INBOX_FIRST));
  const on = mount(false);
  await settle();
  assert.ok(placeRow(on, "Tasks"));
  assert.equal(placeRow(on, "Board"), undefined);
  assert.equal(
    placeRow(on, "Inbox"),
    undefined,
    "the sidebar is the Inbox, so it needs no row for it",
  );
  assert.ok(
    on.querySelector('aside .inbox-tasks[data-placement="sidebar"]'),
    "the sidebar lists the Inbox",
  );
  assert.equal(
    on.querySelector('aside nav[aria-label="Tasks"]'),
    null,
    "the task list stands on its page",
  );
});

test("in a narrow room the inbox-first Inbox lists its items on its own page, across the screen, and the drawer keeps its Inbox row", async () => {
  handState(experimentsOn(EXPERIMENT.INBOX_FIRST));
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const tasks = tasksControl({
    page: TASKS_PAGE.HOME,
    inboxView: { ...tasksControl().inboxView, open: true, listed: true },
  });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopShell, {
          ...shellProps(tasks, PANEL_TAB.TASKS, ignore, { overlay: SIDEBAR_OVERLAY.OPEN }),
          room: SHELL_ROOM.NARROW,
        }),
      ),
    ),
  );
  await settle();
  assert.equal(
    container.querySelector('aside .inbox-tasks[data-placement="sidebar"]'),
    null,
    "the drawer lists no Inbox",
  );
  assert.ok(placeRow(container, "Inbox"), "the drawer's Inbox row stands");
  assert.ok(
    container.querySelector('main .inbox-tasks[data-placement="page"]'),
    "the Inbox's page lists its items",
  );
});

/** The shell in a narrow room, a phone's, over `overrides`, the sidebar patched as given. */
async function mountNarrow(
  overrides: Partial<TasksControl>,
  sidebarPatch: Partial<SidebarCollapse> = {},
  room: ShellRoom = SHELL_ROOM.NARROW,
): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const tasks = tasksControl({ page: TASKS_PAGE.HOME, ...overrides });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopShell, {
          ...shellProps(tasks, PANEL_TAB.TASKS, ignore, sidebarPatch),
          room,
        }),
      ),
    ),
  );
  await settle();
  return container;
}

/** The places bar's items by their words, where the bar stands. */
function barItems(page: HTMLElement): HTMLButtonElement[] {
  return [...page.querySelectorAll<HTMLButtonElement>('nav[aria-label="Places"] button')];
}

function barItem(page: HTMLElement, name: string): HTMLButtonElement {
  const item = barItems(page).find((button) => button.textContent === name);
  assert.ok(item, `the bar offers ${name}`);
  return item;
}

test("on a phone the Tasks page stands over a bar of the window's places, its own marked, and the bar's Inbox opens the Inbox on its list", async () => {
  const asked: string[] = [];
  const page = await mountNarrow({
    boardView: { ...tasksControl().boardView, open: true },
    inboxView: {
      ...tasksControl().inboxView,
      onOpen: () => asked.push("open"),
      onOpenList: () => asked.push("open on its list"),
    },
  });
  assert.deepEqual(
    barItems(page).map((item) => item.textContent),
    ["Inbox", "Tasks", "More"],
  );
  assert.equal(barItem(page, "Tasks").getAttribute("aria-current"), "page");
  assert.equal(barItem(page, "Inbox").getAttribute("aria-current"), null);
  act(() => barItem(page, "Inbox").click());
  assert.deepEqual(asked, ["open on its list"]);
});

test("on a phone the bar's More opens the sidebar's drawer, which holds every other place", async () => {
  let toggled = 0;
  const page = await mountNarrow(
    { boardView: { ...tasksControl().boardView, open: true } },
    { onToggle: () => (toggled += 1) },
  );
  act(() => barItem(page, "More").click());
  assert.equal(toggled, 1);
});

test("on a phone the places bar stands over the Tasks page though the task left behind it holds its panel open, which is not on screen", async () => {
  const page = await mountNarrow({
    boardView: { ...tasksControl().boardView, open: true },
    sidePanel: { ...tasksControl().sidePanel, open: true, fullScreen: true, fullScreenOnly: true },
  });
  assert.deepEqual(
    barItems(page).map((item) => item.textContent),
    ["Inbox", "Tasks", "More"],
  );
});

test("on a phone the drawer More opened leaves the bar's other places inert, as the work it covers is, and More still puts it away", async () => {
  const page = await mountNarrow(
    { boardView: { ...tasksControl().boardView, open: true } },
    { overlay: SIDEBAR_OVERLAY.OPEN },
  );
  assert.equal(barItem(page, "Inbox").hasAttribute("inert"), true);
  assert.equal(barItem(page, "Tasks").hasAttribute("inert"), true);
  assert.equal(barItem(page, "More").hasAttribute("inert"), false);
  assert.equal(barItem(page, "More").getAttribute("aria-expanded"), "true");
});

/** What a reader hears an item named: its words, less what is drawn for the eye alone. */
function spokenName(item: HTMLElement): string {
  const heard = item.cloneNode(true) as HTMLElement;
  for (const unheard of heard.querySelectorAll('[aria-hidden="true"]')) unheard.remove();
  return heard.textContent ?? "";
}

test("on a phone the bar's Inbox and Chat wear the counts the drawer's rows show, named in the sidebar's words, and none at zero", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const chat = fixtureChat({ fixtureMode: true }, 0);
  const listed = {
    tasks: [DOCUMENT_TASK],
    inbox: [],
    inboxTasks: [{ taskId: DOCUMENT_TASK.id, items: 3, toDo: 3, updatedAt: 0 }],
  };
  const page = await mountNarrow(
    {
      boardView: { ...tasksControl().boardView, open: true },
      chatView: { ...tasksControl().chatView, available: true, chat },
      listed,
    },
    { overlay: SIDEBAR_OVERLAY.OPEN },
  );
  const inbox = barItems(page).find((item) => spokenName(item) === "Inbox, 3 need you");
  const chatItem = barItems(page).find((item) => spokenName(item) === "Chat, 4 need you");
  assert.ok(inbox, "the bar's Inbox is named with its count");
  assert.ok(chatItem, "the bar's Chat is named with its count");
  assert.match(inbox.textContent ?? "", /3/u, "the Inbox's count is drawn");
  assert.match(chatItem.textContent ?? "", /4/u, "Chat's count is drawn");
  assert.match(
    placeRow(page, "Inbox")?.textContent ?? "",
    /^Inbox3 need you/u,
    "the drawer counts the same",
  );
  assert.equal(chatRow(page)?.textContent, "Chat4 need you", "the drawer counts the same");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const none = await mountNarrow({
    boardView: { ...tasksControl().boardView, open: true },
    chatView: { ...tasksControl().chatView, available: true },
  });
  assert.deepEqual(
    barItems(none).map((item) => [spokenName(item), item.textContent]),
    [
      ["Inbox", "Inbox"],
      ["Tasks", "Tasks"],
      ["Chat", "Chat"],
      ["More", "More"],
    ],
    "nothing waiting, nothing is drawn or said",
  );
});

test("the places bar stands only on a phone's lists: an open task, an Inbox item, an automation's editor, and a wide window keep the whole screen", async () => {
  const onTask = await mountNarrow({ page: TASKS_PAGE.DOCUMENT });
  assert.deepEqual(barItems(onTask), [], "an open task keeps the screen");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const onItem = await mountNarrow({
    inboxView: {
      ...tasksControl().inboxView,
      open: true,
      listed: false,
      chosen: { taskId: "task-1", itemId: "item-1" },
    },
  });
  assert.deepEqual(barItems(onItem), [], "an item being read keeps the screen");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const onList = await mountNarrow({
    inboxView: { ...tasksControl().inboxView, open: true, listed: true },
  });
  assert.equal(barItem(onList, "Inbox").getAttribute("aria-current"), "page");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const editor = await mountNarrow({
    automationsView: {
      ...tasksControl().automationsView,
      open: true,
      place: { kind: AUTOMATIONS_PAGE.NEW },
    },
  });
  assert.deepEqual(barItems(editor), [], "an automation's editor keeps the screen");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const wide = await mountNarrow(
    { boardView: { ...tasksControl().boardView, open: true } },
    {},
    SHELL_ROOM.WIDE,
  );
  assert.deepEqual(barItems(wide), [], "a wide window keeps its sidebar");
});

test("the Automations page's sidebar row and its command stand with no experiment on", async () => {
  handState({});
  const page = mount(false);
  await settle();
  assert.ok(placeRow(page, "Automations"));
  assert.equal(runAppCommand(APP_COMMAND.AUTOMATIONS), true);
});

test("⇧⌘B opens the Tasks page, bringing the Tasks tab forward from Settings, and the Tasks row names the chord", async () => {
  handState({});
  const went: string[] = [];
  const boardView = { ...tasksControl().boardView, onOpen: () => went.push("tasks page") };
  mount(false, false, { boardView }, PANEL_TAB.SETTINGS, (tab) => went.push(tab));
  await settle();
  assert.equal(runAppCommand(APP_COMMAND.TASKS), true);
  assert.deepEqual(went, [PANEL_TAB.TASKS, "tasks page"]);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const page = mount(false);
  await settle();
  assert.equal(placeRow(page, "Tasks")?.getAttribute("aria-keyshortcuts"), "Meta+Shift+B");
});

test("while the Automations pages are still loading their frame stands the list as quiet rows, and Escape closes Automations as the list does once it stands", async () => {
  const closed: string[] = [];
  const automationsView = {
    ...tasksControl().automationsView,
    open: false,
    place: { kind: AUTOMATIONS_PAGE.LIST } as const,
    onOpen: ignore,
    onClose: () => closed.push("closed"),
  };
  const registry = AtomRegistry.make();
  handState({});
  mount(
    false,
    false,
    { workspaces: [ACME], workspace: ACME, automationsView },
    PANEL_TAB.TASKS,
    ignore,
    {},
    registry,
  );
  await settle();
  act(() => root?.unmount());
  document.body.innerHTML = "";

  // Note that the window's state has landed in the registry, so Automations opens within one render, before their chunk can.
  const page = mount(
    false,
    false,
    { workspaces: [ACME], workspace: ACME, automationsView: { ...automationsView, open: true } },
    PANEL_TAB.TASKS,
    ignore,
    {},
    registry,
  );
  const loading = page.querySelector("section[aria-label=Automations]");
  assert.ok(loading, "the pages' frame stands");
  assert.equal(loading.querySelector("h1")?.textContent, "Automations");
  const wait = loading.querySelector("[role=status]");
  assert.equal(wait?.textContent, "Reading your automations…", "the list stands as quiet rows");
  assert.ok((wait?.querySelectorAll(".luke-skeleton").length ?? 0) > 0);
  assert.equal(loading.querySelector("[role=switch]"), null, "their chunk has not loaded yet");
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS), "Automations' way out is offered");
  });

  assert.deepEqual(closed, ["closed"]);
});

test("while a version history's chunk is still loading, its Back row and Escape leave the history, as they do once it stands", async () => {
  const closed: string[] = [];
  const history = { ...tasksControl().history, open: true, onClose: () => closed.push("closed") };
  handState({});
  const page = mount(false, false, { history });
  const versions = page.querySelector<HTMLElement>("nav[aria-label=Versions]");
  assert.ok(versions, "the versions' column stands");
  assert.equal(versions.querySelector("[role=listbox], ul"), null, "its chunk has not loaded yet");
  const back = [...versions.querySelectorAll("button")].find(
    (button) => button.textContent?.trim().startsWith("Back") === true,
  );
  assert.ok(back, "the Back row stands");
  act(() => back.click());
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY), "Escape leaves the history");
  });
  assert.deepEqual(closed, ["closed", "closed"]);
  await settle();
});

test("the Automations page stands in the plan's place, titled for the listed workspace", async () => {
  const closed: string[] = [];
  const automationsView = {
    ...tasksControl().automationsView,
    open: true,
    place: { kind: AUTOMATIONS_PAGE.LIST } as const,
    onOpen: ignore,
    onClose: () => closed.push("closed"),
  };
  const overrides = {
    workspaces: [ACME],
    workspace: ACME,
    automationsView,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
  };

  handState({});
  const page = mount(false, false, overrides);
  await settle();
  assert.ok(page.querySelector("section[aria-label=Automations]"));
  assert.equal(document.title, "Automations — Acme");
  assert.deepEqual(closed, [], "nothing closes it");
});

/** The task the call in progress is about, which none of the places below shows with its call bar. */
const CALL_TASK_NAME = "Checkout redesign";

/** Every place in the window the developer can stand while a call goes on about another task, as the shell is handed it. */
const PLACE = {
  HOME: "a new account's welcome",
  OTHER_TASK: "another plan",
  INBOX: "the Inbox",
  AGENT_PAGE: "an agent's page",
  PERSON_PAGE: "a person's page",
  AUTOMATIONS: "the Automations page",
  SIDE_PANEL_FULL_SCREEN: "a side panel filling the window",
  SETTINGS: "Settings",
  VERSION_HISTORY: "a plan's version history",
} as const;

type Place = (typeof PLACE)[keyof typeof PLACE];

/** The column at the window's left in each place: the tasks' sidebar, which folds, or a column of the place's own, which does not. */
const LEFT_COLUMN = {
  [PLACE.HOME]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.OTHER_TASK]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.INBOX]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.AGENT_PAGE]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.PERSON_PAGE]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.AUTOMATIONS]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.SIDE_PANEL_FULL_SCREEN]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.SETTINGS]: { selector: 'nav[aria-label="Settings pages"]', folds: false },
  [PLACE.VERSION_HISTORY]: { selector: 'nav[aria-label="Versions"]', folds: false },
} as const satisfies Record<Place, { selector: string; folds: boolean }>;

/** The tab and the tasks' state that stand the window in a place. */
function placed(place: Place) {
  const control = tasksControl();
  const onTask = {
    page: TASKS_PAGE.DOCUMENT,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
  } as const;
  const tasks = {
    [PLACE.HOME]: { page: TASKS_PAGE.HOME },
    [PLACE.OTHER_TASK]: onTask,
    [PLACE.INBOX]: { inboxView: { ...control.inboxView, open: true } },
    [PLACE.AGENT_PAGE]: { agentView: { ...control.agentView, agentId: "agent-page-1" } },
    [PLACE.PERSON_PAGE]: { personView: { ...control.personView, userId: "user-charles" } },
    [PLACE.AUTOMATIONS]: { automationsView: { ...control.automationsView, open: true } },
    [PLACE.SIDE_PANEL_FULL_SCREEN]: {
      ...onTask,
      sidePanel: { ...control.sidePanel, open: true, fullScreen: true },
    },
    [PLACE.SETTINGS]: { page: TASKS_PAGE.HOME },
    [PLACE.VERSION_HISTORY]: { ...onTask, history: { ...control.history, open: true } },
  } satisfies Record<Place, Partial<TasksControl>>;
  return {
    tab: place === PLACE.SETTINGS ? PANEL_TAB.SETTINGS : PANEL_TAB.TASKS,
    tasks: tasks[place],
  };
}

/** The shell standing in a place with a call in progress about another task, its card's presses sent as `App` sends them. */
function CallShell({ place, folded }: { place: Place; folded: boolean }): React.JSX.Element {
  const { tell } = useAct();
  const { tab, tasks } = placed(place);
  // The card is handed down as the window's root hands it, past every page between.
  const call: CallCardInput = {
    card: { taskName: CALL_TASK_NAME, status: undefined, microphoneMuted: false },
    speakerMuted: false,
    controls: callControls(tell, false),
  };
  const shell = createElement(DesktopShell, {
    gates: {
      accountRequired: false,
      onBeginSignIn: ignore,
      onCancelSignIn: ignore,
    },
    tab,
    onTabChange: ignore,
    tasks: tasksControl(tasks),
    history: {
      canGoBack: false,
      canGoForward: false,
      onBack: ignore,
      onForward: ignore,
      steps: { back: [], forward: [] },
      onGoTo: ignore,
      onLeaveVersionHistory: ignore,
      away: undefined,
      onLeave: ignore,
    },
    sidebar: {
      collapsed: folded,
      compact: false,
      overlay: SIDEBAR_OVERLAY.CLOSED,
      width: 264,
      onToggle: ignore,
      onOverlay: ignore,
      onResize: ignore,
      staged: false,
    },
    room: SHELL_ROOM.WIDE,
    settingsStep: { listed: true, onList: ignore },
    settings: SETTINGS,
  });
  return createElement(CallCardContext.Provider, { value: call }, shell);
}

/** Every act the window sent over the bridge, by kind, in order. */
let sentActs: string[] = [];

/** The port kinds this window's fake refuses rather than answers with nothing. */
const REFUSED_ON_PORT: readonly string[] = Object.values({
  ...ACCOUNT_ACT_KIND,
  ...AGENT_ACT_KIND,
  ...AGENT_INBOX_ACT_KIND,
  ...AUTOMATION_ACT_KIND,
  ...INTEGRATION_ACT_KIND,
  ...SETTINGS_ACT_KIND,
  ...TASKS_ACT_KIND,
  ...UPDATE_ACT_KIND,
  ...WINDOW_SURFACE_ACT_KIND,
}).filter((kind) => kind !== AGENT_ACT_KIND.CODING_AGENTS_SHOWN);

/**
 * The bridge as the window meets it, every act written down, and the chunks
 * of Settings and of the pages drawn on demand
 * (`pages-on-demand.ts`) already loaded, as each is once it has opened once,
 * so each stands within a settle.
 */
async function handBridge(): Promise<void> {
  await Promise.all([
    import("./desktop-settings.js"),
    import("./desktop-version-history.js"),
    import("./person-page.js"),
  ]);
  handState({});
  sentActs = [];
  const bridge = appBridge();
  fakeAppBridge({
    ...bridge,
  });
  fakeActPortAnswering((request) => {
    sentActs.push(request.kind);
    // A read of the account's automations, integrations, or its coding agents, their Inbox, or the chat, an account or settings act, a task kind, and the platform's updater, Browser tab, and window acts are refused.
    if (REFUSED_ON_PORT.includes(request.kind)) return Promise.reject(refusedOnPort("Not here."));
    return Promise.resolve(undefined);
  });
}

/** Where the window draws the call card: on which surface, and whether at the foot of the column at the window's left. */
function cardStanding(page: HTMLElement, place: Place) {
  const cards = page.querySelectorAll<HTMLElement>('section.call-card[aria-label="Call"]');
  assert.equal(cards.length, 1, `one call card stands over ${place}`);
  const [card] = cards;
  assert.ok(card);
  const foot = card.closest(".sidebar-foot");
  return {
    surface: card.dataset.surface ?? "",
    docked: foot !== null && foot.parentElement === page.querySelector(LEFT_COLUMN[place].selector),
  };
}

/** Presses the card's way back to the call's task. */
function pressReturn(page: HTMLElement): void {
  const button = page.querySelector<HTMLButtonElement>(
    `section.call-card button[aria-label="Open ${CALL_TASK_NAME}"]`,
  );
  assert.ok(button, "the card offers the way back to the call's plan");
  act(() => button.click());
}

const PLACES = Object.values(PLACE);

test("the side panel's toggle stands on a plan and on an agent's page, which keeps a panel of its own, and nowhere else the plan's place is taken", async () => {
  await handBridge();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  const toggled: Partial<Record<Place, boolean>> = {};
  for (const place of PLACES) {
    act(() =>
      root?.render(onRegistry(registry, createElement(CallShell, { place, folded: false }))),
    );
    await settle();
    toggled[place] = [...container.querySelectorAll("button")].some((button) =>
      ["Show panel", "Hide panel"].includes(button.getAttribute("aria-label") ?? ""),
    );
  }
  assert.deepEqual(toggled, {
    [PLACE.HOME]: false,
    [PLACE.OTHER_TASK]: true,
    [PLACE.INBOX]: false,
    [PLACE.AGENT_PAGE]: true,
    [PLACE.PERSON_PAGE]: false,
    [PLACE.AUTOMATIONS]: false,
    [PLACE.SIDE_PANEL_FULL_SCREEN]: true,
    [PLACE.SETTINGS]: false,
    [PLACE.VERSION_HISTORY]: false,
  });
});

test("⌘F opens a find over every page that stands in the window, and Settings keeps it for its own search", async () => {
  await handBridge();
  const found: Partial<Record<Place, boolean>> = {};
  for (const place of PLACES) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        onRegistry(AtomRegistry.make(), createElement(CallShell, { place, folded: false })),
      ),
    );
    await settle();
    act(() => {
      runAppCommand(APP_COMMAND.FIND);
    });
    found[place] = container.querySelector("[role='search'][aria-label='Find']") !== null;
    act(() => root?.unmount());
    container.remove();
  }
  assert.deepEqual(found, {
    // Note that the welcome holds only New task's composer, so it holds no words to find.
    [PLACE.HOME]: false,
    [PLACE.OTHER_TASK]: true,
    [PLACE.INBOX]: true,
    // Note that this agent is never read here, and an agent's page finds once its agent is drawn (`desktop-agent-page.test.ts`).
    [PLACE.AGENT_PAGE]: false,
    [PLACE.PERSON_PAGE]: true,
    [PLACE.AUTOMATIONS]: true,
    // Note that the panel filling the window holds the keys, on its Board, whose canvas no find reads.
    [PLACE.SIDE_PANEL_FULL_SCREEN]: false,
    [PLACE.SETTINGS]: false,
    [PLACE.VERSION_HISTORY]: true,
  });
});

test("walking every place in the window during a call about another plan, the card stays at the foot of the column at the window's left, and its way back asks for the call's plan from each", async () => {
  await handBridge();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  const standing: Record<string, ReturnType<typeof cardStanding>> = {};
  for (const place of PLACES) {
    act(() =>
      root?.render(onRegistry(registry, createElement(CallShell, { place, folded: false }))),
    );
    await settle();
    standing[place] = cardStanding(container, place);
    sentActs = [];
    pressReturn(container);
    assert.deepEqual(sentActs, [ACT_KIND.CALL_SHOW_AGENT], `the way back from ${place}`);
  }
  assert.deepEqual(
    standing,
    Object.fromEntries(PLACES.map((place) => [place, { surface: "sidebar", docked: true }])),
  );
});

test("with the plans' sidebar folded, the card floats in the window's corner wherever the sidebar would have held it, and stays at the foot of Settings' and a version history's own columns, which do not fold", async () => {
  await handBridge();
  const standing: Record<string, ReturnType<typeof cardStanding>> = {};
  for (const place of PLACES) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        onRegistry(AtomRegistry.make(), createElement(CallShell, { place, folded: true })),
      ),
    );
    await settle();
    standing[place] = cardStanding(container, place);
    sentActs = [];
    pressReturn(container);
    assert.deepEqual(sentActs, [ACT_KIND.CALL_SHOW_AGENT], `the way back from ${place}`);
    act(() => root?.unmount());
    container.remove();
  }
  assert.deepEqual(
    standing,
    Object.fromEntries(
      PLACES.map((place) => [
        place,
        LEFT_COLUMN[place].folds
          ? { surface: "floating", docked: false }
          : { surface: "sidebar", docked: true },
      ]),
    ),
  );
});

test("a plan's chip in a plan's version history hangs the plan's card, as the plan's own words do", () => {
  const body = `## Rollout\n\nAs in [@the plan](https://tryluke.dev/acme/plan/${DOCUMENT_TASK.id}).\n`;
  const control = tasksControl();
  const page = mount(false, false, {
    page: TASKS_PAGE.DOCUMENT,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    tasks: [DOCUMENT_TASK],
    history: {
      ...control.history,
      open: true,
      viewing: {
        line: {
          seq: 2,
          lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 0, duringCall: true },
          startedAt: 0,
          changes: 1,
        },
        current: true,
        read: { kind: HISTORY_READ.READY, document: { body, assumptions: [] }, previous: null },
      },
    },
  });
  const chip = page.querySelector("[data-mention-ref]");
  assert.ok(chip, "the version draws the plan's chip");

  restOn(chip);

  const card = document.querySelector(".luke-tooltip-card [data-task-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, DOCUMENT_NAME);
});

/** The sidebar's Chat row, where one stands. */
function chatRow(page: HTMLElement): HTMLButtonElement | undefined {
  return placeRow(page, "Chat");
}

test("the sidebar's Chat row stands only while the account has Chat on and a chat is available, counts what needs the developer in the Inbox's words, and opens Chat in the plan's place, which it marks while Home's row is not", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  assert.equal(chatRow(mount(false)), undefined, "no chat is available");
  act(() => root?.unmount());

  let opened = 0;
  const chat = fixtureChat({ fixtureMode: true }, 0);
  const view = { ...tasksControl().chatView, available: true, chat, onOpen: () => (opened += 1) };
  const page = mount(false, false, { chatView: view });
  await settle();
  const row = chatRow(page);
  assert.equal(row?.textContent, "Chat4 need you");
  assert.equal(row?.getAttribute("aria-current"), null);
  act(() => row?.click());
  assert.equal(opened, 1);
  act(() => root?.unmount());

  const open = mount(false, false, { chatView: { ...view, open: true } });
  await settle();
  assert.equal(chatRow(open)?.getAttribute("aria-current"), "page");
  assert.equal(placeRow(open, "Inbox")?.getAttribute("aria-current"), null);
  assert.ok(
    open.querySelector(".desktop-main > .page-find > .chat-view"),
    "Chat stands in the plan's place",
  );
});

test("⌘K's Chat opens Chat only while the account has it on and a chat is available, and the row counts what waits in the Inbox's accent", async () => {
  let opened = 0;
  const chat = fixtureChat({ fixtureMode: true }, 0);
  const view = { ...tasksControl().chatView, available: true, chat, onOpen: () => (opened += 1) };
  handState({});
  mount(false, false, { chatView: view });
  await settle();
  assert.equal(runAppCommand(APP_COMMAND.CHAT), false);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handState(experimentsOn(EXPERIMENT.CHAT));
  const page = mount(false, false, { chatView: view });
  await settle();
  assert.equal(runAppCommand(APP_COMMAND.CHAT), true);
  assert.equal(opened, 1);
  const count = chatRow(page)?.querySelector<HTMLElement>(".luke-nav-item-count");
  assert.equal(count?.dataset.tone, NAV_COUNT_TONE.ACCENT);
});

test("⌘K's Admin opens the Admin place for an admin alone, and is offered nothing for anyone else", async () => {
  let opened = 0;
  const adminView = { ...tasksControl().adminView, onOpen: () => (opened += 1) };
  handState({}, { access: { admin: false } });
  mount(false, false, { adminView });
  await settle();
  assert.equal(runAppCommand(APP_COMMAND.ADMIN), false);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handState({}, { access: { admin: true } });
  mount(false, false, { adminView });
  await settle();
  assert.equal(runAppCommand(APP_COMMAND.ADMIN), true);
  assert.equal(opened, 1);
});

test("with Chat off for the account, its row stands nowhere, and Chat standing in the plan's place gives it back", async () => {
  handState({});
  const closed: string[] = [];
  const chat = fixtureChat({ fixtureMode: true }, 0);
  const view = {
    ...tasksControl().chatView,
    available: true,
    chat,
    onClose: () => closed.push("closed"),
  };
  const off = mount(false, false, { chatView: view });
  await settle();
  assert.equal(chatRow(off), undefined);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const standing = mount(false, false, { chatView: { ...view, open: true } });
  await settle();
  assert.equal(standing.querySelector(".chat-view"), null, "Chat is not drawn");
  assert.deepEqual(closed, ["closed"]);
});

test("a fixture run staged on Chat offers it with no account to turn its experiment on, where any other run does not", async () => {
  const chat = fixtureChat({ fixtureMode: true }, 0);
  const view = { ...tasksControl().chatView, available: true, chat };
  const run = { ...stateWith({}, {}).run, fixtureMode: true };
  handState({}, { run: { ...run, profile: RUN_PROFILE.CHAT } });
  const staged = mount(false, false, { chatView: view });
  await settle();
  assert.ok(chatRow(staged), "the chat profile's run offers Chat");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handState({}, { run: { ...run, profile: RUN_PROFILE.TASKS } });
  const other = mount(false, false, { chatView: view });
  await settle();
  assert.equal(chatRow(other), undefined, "another fixture run does not");
});

/** The offline status in the title bar beside the traffic lights, if one stands. */
function titleBarOffline(page: HTMLElement): Element | null {
  return page.querySelector('.title-bar-controls [role="status"][aria-label="Offline"]');
}

test("with the sidebar folded, the Mac offline says so in the title bar beside New task, and nothing does online", async () => {
  handState({}, { network: { online: false } });
  const offline = mount(false);
  await settle();
  assert.ok(titleBarOffline(offline), "the title bar says the Mac is offline");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handState({}, { network: { online: true } });
  const online = mount(false);
  await settle();
  assert.equal(titleBarOffline(online), null);
});

test("the sign-in, which needs the network, says over it when the Mac is offline", async () => {
  handState({}, { network: { online: false } });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const props = shellProps(tasksControl(), PANEL_TAB.TASKS, ignore, {});
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopShell, {
          ...props,
          gates: { ...props.gates, accountRequired: true },
          settings: { ...SETTINGS, account: { status: ACCOUNT_STATUS.SIGNED_OUT } },
        }),
      ),
    ),
  );
  await settle();

  assert.ok(container.querySelector(".desktop-onboarding"), "the sign-in stands");
  assert.equal(titleBarOffline(container)?.textContent, "Offline");
});

test("on a phone an open task leads its own row with the way back the window's history names, in the sidebar toggle's place, and a wide window keeps the toggle", async () => {
  const left: string[] = [];
  const render = (away: Parameters<typeof DesktopShell>[0]["history"]["away"], room: ShellRoom) => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    const tasks = tasksControl({
      page: TASKS_PAGE.DOCUMENT,
      region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    });
    const props = shellProps(tasks, PANEL_TAB.TASKS, ignore, {});
    act(() =>
      root?.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(DesktopShell, {
            ...props,
            history: { ...props.history, away, onLeave: () => left.push("left") },
            room,
          }),
        ),
      ),
    );
    return container;
  };
  const back = (page: HTMLElement) =>
    page.querySelector<HTMLButtonElement>(".task-head .phone-head-start button") ??
    assert.fail("a way back");

  const fromInbox = render({ title: { label: "Inbox" } }, SHELL_ROOM.NARROW);
  await settle();
  assert.equal(back(fromInbox).getAttribute("aria-label"), "Back to Inbox");
  assert.equal(fromInbox.querySelector(".desktop-shell > .title-bar-controls"), null);
  act(() => back(fromInbox).click());
  assert.deepEqual(left, ["left"]);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const fromNowhere = render(undefined, SHELL_ROOM.NARROW);
  await settle();
  assert.equal(
    back(fromNowhere).getAttribute("aria-label"),
    "Back to Tasks",
    "with no page behind, the Tasks page",
  );
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const wide = render({ title: { label: "Inbox" } }, SHELL_ROOM.WIDE);
  await settle();
  assert.equal(wide.querySelector(".task-head"), null);
  assert.ok(
    wide.querySelector(".desktop-shell > .title-bar-controls"),
    "the sidebar's toggle stands",
  );
});

test("on a phone an open task, which draws no sidebar toggle, still answers the sidebar's chord with the drawer", async () => {
  let toggled = 0;
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopShell, {
          ...shellProps(tasks, PANEL_TAB.TASKS, ignore, { onToggle: () => (toggled += 1) }),
          room: SHELL_ROOM.NARROW,
        }),
      ),
    ),
  );
  await settle();
  assert.equal(container.querySelector(".desktop-shell > .title-bar-controls"), null);
  act(() => runAppCommand(APP_COMMAND.TOGGLE_SIDEBAR));
  assert.equal(toggled, 1);
});

/** A finger's swipe from `from` to `to` across the screen, at the height of the page's middle. */
function fingerSwipe(target: HTMLElement, from: number, to: number, pointerType = "touch"): void {
  const at = (type: string, x: number) =>
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: 400,
      pointerId: 3,
      pointerType,
      isPrimary: true,
    });
  act(() => {
    target.dispatchEvent(at("pointerdown", from));
    target.dispatchEvent(at("pointermove", (from + to) / 2));
    target.dispatchEvent(at("pointermove", to));
    target.dispatchEvent(at("pointerup", to));
  });
}

test("on a phone a finger swiped in from the screen's left edge opens the drawer over a dimmed window, and a mouse's drag does not", async () => {
  const asked: string[] = [];
  const onOverlay = (overlay: string) => asked.push(overlay);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const page = await mountNarrow(
    { boardView: { ...tasksControl().boardView, open: true } },
    {
      onOverlay,
    },
  );
  const work = page.querySelector<HTMLElement>(".desktop-main");
  assert.ok(work);
  fingerSwipe(work, 300, 500, "mouse");
  assert.deepEqual(asked, [], "a mouse's drag opens nothing");
  fingerSwipe(work, 30, 260);
  assert.deepEqual(asked, [SIDEBAR_OVERLAY.OPEN]);
  assert.equal(page.querySelector(".luke-drawer-scrim")?.getAttribute("data-open"), "false");
});

test("on a phone the drawer opened stands over a dimmed window, and beside the work there is none", async () => {
  const phone = await mountNarrow(
    { boardView: { ...tasksControl().boardView, open: true } },
    { overlay: SIDEBAR_OVERLAY.OPEN },
  );
  assert.equal(phone.querySelector(".luke-drawer-scrim")?.getAttribute("data-open"), "true");
  act(() => root?.unmount());
  const wide = await mountNarrow(
    { boardView: { ...tasksControl().boardView, open: true } },
    { overlay: SIDEBAR_OVERLAY.OPEN },
    SHELL_ROOM.WIDE,
  );
  assert.equal(wide.querySelector(".luke-drawer-scrim"), null);
});

test("on a phone no page draws the title bar's controls over its own head, an agent's page and the Automations list among them, and the panel's chord still answers where its toggle stood", async () => {
  let toggled = 0;
  const sidePanel = { ...tasksControl().sidePanel, onToggle: () => (toggled += 1) };
  const agentPage = await mountNarrow({
    page: TASKS_PAGE.DOCUMENT,
    agentView: { ...tasksControl().agentView, agentId: "agent-1" },
    sidePanel,
  });
  assert.equal(agentPage.querySelector(".desktop-shell > .title-bar-controls"), null);
  act(() => runAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL));
  assert.equal(toggled, 1, "the panel's chord answers on the agent's page");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const automations = await mountNarrow({
    automationsView: { ...tasksControl().automationsView, open: true },
  });
  assert.equal(
    automations.querySelector(".desktop-shell > .title-bar-controls"),
    null,
    "nor over the Automations list",
  );
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const wide = await mountNarrow(
    { page: TASKS_PAGE.DOCUMENT, agentView: { ...tasksControl().agentView, agentId: "agent-1" } },
    {},
    SHELL_ROOM.WIDE,
  );
  assert.ok(wide.querySelector(".desktop-shell > .title-bar-controls"), "a wide window keeps them");
  assert.ok(wide.querySelector('.title-bar-controls[data-edge="end"]'), "and the panel's toggle");
});
