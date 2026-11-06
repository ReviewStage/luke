// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { PLAN_ACTOR, type Task } from "@repo/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
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
} from "@repo/host/contract";
import { EXPERIMENT, type ExperimentChoices, HOST_CAPABILITY } from "@repo/settings";
import { MICROPHONE_STATUS } from "@repo/settings/microphone";
import { NOTIFICATIONS_STATUS } from "@repo/settings/settings-controls";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { experimentsOn } from "@repo/settings/testing";
import { UPDATE_STATUS } from "@repo/settings/update";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { runAppCommand } from "../app-commands.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import type { SettingsPanelProps } from "../settings/settings-panel.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { MAIN_TAB } from "../tasks/use-main-tabs.js";
import { HISTORY_READ } from "../tasks/use-plan-history.js";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  fakeActPortAnswering,
  fakeActs,
  fakeAppBridge,
  refusedOnPort,
} from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handCapabilities, handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_NAME, DOCUMENT_TASK } from "../testing/document-task.js";
import { restOn } from "../testing/hint-rest.js";
import { pressInPhoneHead, readPhoneHead } from "../testing/phone-head.js";
import { SHELL_AT, shellRouterEachTest } from "../testing/shell-router.js";
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
    onRequest: ignore,
    onOpenSettings: ignore,
  },
  notifications: {
    status: NOTIFICATIONS_STATUS.UNKNOWN,
    packaged: true,
    onOpenSettings: ignore,
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
    onMoveToApplications: ignore,
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

/** The router the shell this test draws stands under, read before each test (`shell-router.ts`). */
const routed = shellRouterEachTest();

/** `shell` drawn under the test's router, standing where `standing` says, else where its props say. */
function underRouter(shell: ReactElement, standing?: string): ReactElement {
  return routed().under(shell, standing);
}

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
      onLeaveRouted: ignore,
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
      inboxView: {
        open: inboxOpen,
        chosen: undefined,
        onOpen: ignore,
        onClose: ignore,
        onChoose: ignore,
        onOpenItem: () => undefined,
        onClear: ignore,
        pages: undefined,
        onTaskAgents: () => undefined,
      },
      onNewTask: () => setAsked(true),
      newTask: { ...control.newTask, open: asked, onClose: () => setAsked(false) },
      ...overrides,
    });
    return createElement(DesktopShell, shellProps(tasks, tab, onTabChange, sidebarPatch));
  }
  const at =
    tab === PANEL_TAB.SETTINGS
      ? SHELL_AT.SETTINGS
      : overrides.adminView?.open === true
        ? SHELL_AT.ADMIN
        : undefined;
  act(() => root?.render(onRegistry(registry, underRouter(createElement(Shell), at))));
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

test("while Settings is still loading its frame stands, a page of placeholder sections under the one bar Settings stands under beside the page list's column, and Escape pressed there leaves Settings for the plans, as it does once Settings stands", async () => {
  const tabs: PanelTab[] = [];
  const page = mount(false, {}, PANEL_TAB.SETTINGS, (tab) => tabs.push(tab));
  // The router goes to Settings, whose frame stands while its chunk is read.
  await act(async () => {
    await Promise.resolve();
  });
  const placeholder = page.querySelector('section[aria-label="Settings"] [role="status"]');
  const bars = page.querySelectorAll(
    'section[aria-label="Settings"] :is(.desktop-drag-strip, .ui-toolbar)',
  );

  assert.deepEqual(
    [
      page.querySelector('nav[aria-label="Settings pages"]') !== null,
      placeholder?.textContent,
      placeholder?.querySelectorAll(".ui-settings-section-card").length,
      bars.length,
    ],
    [true, "Reading Settings", 1, 1],
  );

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_SETTINGS), "Settings' way out is offered");
  });

  assert.deepEqual(tabs, [PANEL_TAB.TASKS]);
});

/** The shell on the tasks with its tab chosen from outside, so a test can open Settings and leave it. */
async function mountSwitching(): Promise<(tab: PanelTab) => Promise<void>> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  const draw = async (tab: PanelTab) => {
    act(() =>
      root?.render(
        onRegistry(
          registry,
          underRouter(
            createElement(
              DesktopShell,
              shellProps(tasksControl({ page: TASKS_PAGE.DOCUMENT }), tab, ignore, {}),
            ),
          ),
        ),
      ),
    );
    // The router goes where the tab stands, Settings or the places, and draws it once its chunk is read.
    await act(() => routed().settled());
  };
  await draw(PANEL_TAB.TASKS);
  return draw;
}

test("leaving Settings gives the keyboard back to the control that held it as Settings opened", async () => {
  handState({});
  const draw = await mountSwitching();
  const opener = document.querySelector<HTMLElement>(
    '.title-bar-controls button[aria-label="New task"]',
  );
  assert.ok(opener, "the title bar's New task stands");
  opener.focus();

  await draw(PANEL_TAB.SETTINGS);
  assert.ok(
    document.activeElement !== opener,
    "Settings draws over the window, the keyboard off the control that opened it",
  );
  await draw(PANEL_TAB.TASKS);

  const back = document.activeElement;
  assert.equal(back?.getAttribute("aria-label"), "New task");
  assert.ok(back?.isConnected);
});

test("leaving Settings where the control that held the keyboard is gone leaves it with the window, and raises nothing", async () => {
  handState({});
  const draw = await mountSwitching();
  const opener = document.createElement("button");
  opener.setAttribute("aria-label", "Gone by then");
  document.body.append(opener);
  opener.focus();

  await draw(PANEL_TAB.SETTINGS);
  opener.remove();

  await assert.doesNotReject(() => draw(PANEL_TAB.TASKS));
  assert.ok(document.activeElement === document.body, "the keyboard is with the window");
});

test("leaving Settings hands the keyboard to no control of a name several share, as a row's Pin is, rather than to the wrong row's", async () => {
  handState({});
  const draw = await mountSwitching();
  const pin = () => {
    const button = document.createElement("button");
    button.setAttribute("aria-label", "Pin");
    return button;
  };
  const [first, second] = [pin(), pin()];
  document.body.append(first, second);
  second.focus();

  await draw(PANEL_TAB.SETTINGS);
  first.remove();
  second.remove();
  document.body.append(pin(), pin());
  await draw(PANEL_TAB.TASKS);

  assert.ok(document.activeElement === document.body, "the keyboard is with the window");
});

test("leaving Settings does not hand the keyboard to the one control left of a name several shared as Settings opened", async () => {
  handState({});
  const draw = await mountSwitching();
  const pin = () => {
    const button = document.createElement("button");
    button.setAttribute("aria-label", "Pin");
    return button;
  };
  const [first, second] = [pin(), pin()];
  document.body.append(first, second);
  second.focus();

  await draw(PANEL_TAB.SETTINGS);
  first.remove();
  second.remove();
  document.body.append(pin());
  await draw(PANEL_TAB.TASKS);

  assert.ok(document.activeElement === document.body, "the keyboard is with the window");
});

/**
 * The shell in a narrow room on `tab` over `overrides`, Settings standing on
 * its list or its page as `listed` says, over a history whose Back goes to
 * the Inbox, drawn once and not waited on, so a page still loading stands
 * its frame; every way out and back to a list written down.
 */
function drawLoadingNarrow(
  tab: PanelTab,
  overrides: Partial<TasksControl>,
  listed: boolean,
): { page: HTMLElement; went: string[] } {
  const went: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const tasks = tasksControl({ page: TASKS_PAGE.HOME, ...overrides });
  const props = shellProps(tasks, tab, ignore, {});
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        underRouter(
          createElement(DesktopShell, {
            ...props,
            room: SHELL_ROOM.NARROW,
            settingsStep: { listed, onList: () => went.push("list") },
            history: {
              ...props.history,
              canGoBack: true,
              onBack: () => went.push("back"),
              steps: {
                back: [
                  { at: 0, title: { label: "Inbox" }, page: { kind: "inbox", of: undefined } },
                ],
                forward: [],
              },
            },
          }),
        ),
      ),
    ),
  );
  return { page: container, went };
}

async function mountLoadingNarrow(
  tab: PanelTab,
  overrides: Partial<TasksControl>,
  listed: boolean,
): Promise<{ page: HTMLElement; went: string[] }> {
  const drawn = drawLoadingNarrow(tab, overrides, listed);
  // The router goes to the place, whose frame stands while its chunk is read.
  await act(async () => {
    await Promise.resolve();
  });
  return drawn;
}

test("on a phone, while Settings is still loading, its list and its page stand headed as they will be: the way out or back, and the title centered", async () => {
  const list = await mountLoadingNarrow(PANEL_TAB.SETTINGS, {}, true);
  assert.deepEqual(readPhoneHead(list.page, "settings-pages"), {
    start: ["Back"],
    title: "Settings",
    end: [],
  });
  pressInPhoneHead(list.page, "settings-pages", "Back");
  assert.deepEqual(list.went, ["back"]);
  act(() => root?.unmount());

  const page = await mountLoadingNarrow(PANEL_TAB.SETTINGS, {}, false);
  assert.deepEqual(readPhoneHead(page.page, "settings-page").start, ["Settings"]);
  pressInPhoneHead(page.page, "settings-page", "Settings");
  assert.deepEqual(page.went, ["list"]);
});

test("on a phone, while the account's access is read, Admin stands headed as it will be, its name centered over the bar of its sections", async () => {
  handState({}, { access: { admin: false, pending: true } });
  const adminView = { ...tasksControl().adminView, open: true };
  const { page } = await mountLoadingNarrow(PANEL_TAB.TASKS, { adminView }, true);
  assert.equal(readPhoneHead(page, "admin").title, "Admin");
  assert.ok(page.querySelector('[role="radiogroup"][aria-label="Admin sections"]'));
});

test("with the sidebar folded, New task stands beside its toggle over Home and the Inbox alike", () => {
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

test("an account with no plan raises New task from the title bar over the window, which Escape puts away", () => {
  const page = mount(false);
  const newTask = page.querySelector<HTMLButtonElement>(
    '.title-bar-controls:not([data-edge]) button[aria-label="New task"]',
  );
  assert.ok(newTask, "the title bar offers New task");
  act(() => newTask.click());
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  const name = dialog?.getAttribute("aria-labelledby") ?? assert.fail("the dialog is named");
  assert.equal(document.getElementById(name)?.textContent, "New task");
  act(() => {
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(
    document.querySelector('[role="dialog"][aria-modal="true"]') === null,
    true,
    "Escape puts the dialog away",
  );
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

/** The sidebar's Home row. */
function homeRow(page: HTMLElement): HTMLButtonElement {
  return placeRow(page, "Home") ?? assert.fail("the Home row stands");
}

test("the sidebar's Home row is the place shown on Home, and not over the Inbox", () => {
  assert.equal(homeRow(mount(false)).getAttribute("aria-current"), "page");
  act(() => root?.unmount());
  assert.equal(homeRow(mount(true)).getAttribute("aria-current"), null);
});

test("Home, pressed or by its chord from Settings, brings the Tasks tab forward on Home", () => {
  let home = 0;
  const tabs: PanelTab[] = [];
  mount(false, { onGoHome: () => (home += 1) }, PANEL_TAB.SETTINGS, (tab) => tabs.push(tab));
  act(() => runAppCommand(APP_COMMAND.HOME));
  assert.deepEqual([home, tabs], [1, [PANEL_TAB.TASKS]]);
  act(() => root?.unmount());

  const tasks = mount(false, { onGoHome: () => (home += 1) });
  act(() => homeRow(tasks).click());
  assert.equal(home, 2);
});

const ACME: Workspace = {
  id: DOCUMENT_TASK.workspaceId,
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

test("the window is called by what stands in it: the plan on screen in its own workspace, else the Inbox, Automations, or Settings, and Vespin once signed out", async () => {
  const titled = (inboxOpen: boolean, tab: PanelTab, signedIn = true, workspaces = [ACME]) => {
    mount(
      inboxOpen,
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
    [`${DOCUMENT_NAME} — Acme`, "Inbox — Acme", "Settings", "Vespin", DOCUMENT_NAME],
  );

  mount(false, {
    workspaces: [ACME],
    workspace: ACME,
    automationsView: { ...tasksControl().automationsView, open: true },
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
  });
  assert.equal(document.title, "Automations — Acme");
});

test("a plan opened with its Inbox tab shown rather than its plan is read at once, its row out of the unread weight, while the window's Inbox standing in its place leaves it unread", () => {
  const unreadOnOpen = (inboxOpen: boolean) => {
    const page = mount(
      inboxOpen,
      {
        page: TASKS_PAGE.DOCUMENT,
        tasks: [{ ...DOCUMENT_TASK, readThrough: DOCUMENT_TASK.updatedAt - 1 }],
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
 * The shell with the sidebar unfolded on `listed`, each carrying the read
 * mark the account keeps of it, redrawn over whichever plan `open` names
 * next and the home page for none, the same shell throughout.
 */
function mountListing(listed: readonly Task[]): (open: Task | undefined) => void {
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
    act(() => root?.render(onRegistry(registry, underRouter(createElement(DesktopShell, props)))));
  };
}

/** The sidebar's row for the plan of this name. */
function sidebarRow(name: string): HTMLButtonElement {
  const row = [
    ...document.querySelectorAll<HTMLButtonElement>(".sidebar-tasks > li > button"),
  ].find((each) => each.querySelector(".ui-list-row-title")?.firstChild?.textContent === name);
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
  // Note that the item is read by its words, since its U is drawn beside them.
  const words = (each: Element) => each.querySelector(".ui-menu-item-label")?.textContent ?? "";
  const item = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((each) =>
    /^Mark as (un)?read$/u.test(words(each)),
  );
  act(() => {
    if (choose) item?.click();
    else menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(document.querySelector('[role="menu"]') === null, true, "the menu closes");
  return item === undefined ? undefined : words(item);
}

test("a task's row reads unread by the mark its row carries, the one open only where marked by hand, and its menu asks the service to mark it read or unread", async () => {
  const marks: string[] = [];
  fakeActs({
    act: (request: AnyAct) => {
      if (request.kind !== TASKS_ACT_KIND.TASKS_MARK_READ)
        return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
      marks.push(`${request.payload.readMark}:${request.payload.taskId}`);
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value: true });
    },
  });
  const read = { ...DOCUMENT_TASK, readThrough: DOCUMENT_TASK.updatedAt };
  const changed = { ...NOTES_TASK, readThrough: NOTES_TASK.updatedAt - 1 };
  const draw = mountListing([read, changed]);
  draw(undefined);
  assert.equal(rowUnread(NOTES_TASK.name), "true");
  assert.equal(rowReadMark(DOCUMENT_NAME), "Mark as unread");

  rowReadMark(NOTES_TASK.name, true);
  rowReadMark(DOCUMENT_NAME, true);
  await settle();
  assert.deepEqual(marks, [`read:${NOTES_TASK.id}`, `unread:${DOCUMENT_TASK.id}`]);

  draw(changed);
  assert.equal(rowUnread(NOTES_TASK.name), "false", "the one open reads its changes as they land");
  draw({ ...changed, markedUnread: true });
  assert.equal(rowUnread(NOTES_TASK.name), "true", "a mark by hand reads unread even while open");
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
  const tabs: PanelTab[] = [];
  mount(false, {}, PANEL_TAB.TASKS, (tab) => tabs.push(tab));
  await settle();
  assert.equal(runAppCommand(APP_COMMAND.KEYBOARD_SHORTCUTS), true);
  // Note that choosing the page is what opens Settings on it, so no tab change makes a second step before it.
  assert.deepEqual(tabs, []);
});

test("a press on the Automations row in a floating sidebar puts the sidebar away, as every row's does", async () => {
  const told: SidebarCollapse["overlay"][] = [];
  const page = mount(false, {}, PANEL_TAB.TASKS, ignore, {
    overlay: SIDEBAR_OVERLAY.OPEN,
    onOverlay: (next) => told.push(next),
  });
  await settle();
  const row = placeRow(page, "Automations");
  assert.ok(row);
  act(() => row.click());
  assert.deepEqual(told, [SIDEBAR_OVERLAY.CLOSED]);
});

test("the sidebar offers no Issues row, with every experiment on, since Vespin keeps no issues of its own", async () => {
  handState(experimentsOn(...Object.values(EXPERIMENT)));
  const page = mount(false);
  await settle();
  assert.ok(placeRow(page, "Automations"));
  assert.equal(placeRow(page, "Issues"), undefined);
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
        underRouter(
          createElement(DesktopShell, {
            ...shellProps(tasks, PANEL_TAB.TASKS, ignore, sidebarPatch),
            room,
          }),
        ),
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

/** What a bar item is named: its words, or its label where it is a glyph alone, as New task is. */
function barName(item: HTMLButtonElement): string {
  return item.getAttribute("aria-label") ?? item.textContent ?? "";
}

function barItem(page: HTMLElement, name: string): HTMLButtonElement {
  const item = barItems(page).find((button) => barName(button) === name);
  assert.ok(item, `the bar offers ${name}`);
  return item;
}

test("on a phone the Tasks page stands over a bar of the window's places, its own marked, the bar's Inbox opening the Inbox and its New task New task", async () => {
  const asked: string[] = [];
  const page = await mountNarrow({
    boardView: { ...tasksControl().boardView, open: true },
    inboxView: {
      ...tasksControl().inboxView,
      onOpen: () => asked.push("inbox"),
    },
    onNewTask: () => asked.push("new task"),
  });
  assert.deepEqual(barItems(page).map(barName), ["Inbox", "Tasks", "Search", "New task"]);
  assert.equal(barItem(page, "Tasks").getAttribute("aria-current"), "page");
  assert.equal(barItem(page, "Inbox").getAttribute("aria-current"), null);
  act(() => barItem(page, "Inbox").click());
  act(() => barItem(page, "New task").click());
  assert.deepEqual(asked, ["inbox", "new task"]);
});

test("on a phone the bar's Tasks opens the Tasks page, which stands the sidebar's tree in the work's place", async () => {
  const asked: string[] = [];
  const page = await mountNarrow({
    inboxView: { ...tasksControl().inboxView, open: true },
    boardView: { ...tasksControl().boardView, onOpen: () => asked.push("tasks") },
  });
  act(() => barItem(page, "Tasks").click());
  assert.deepEqual(asked, ["tasks"]);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const tasksPage = await mountNarrow({ boardView: { ...tasksControl().boardView, open: true } });
  const shell = tasksPage.querySelector(".desktop-shell") ?? assert.fail("the shell stands");
  assert.equal(
    shell.getAttribute("data-sidebar-collapsed"),
    "false",
    "the tree is pinned, not a drawer",
  );
  assert.equal(tasksPage.querySelector("aside.desktop-sidebar")?.hasAttribute("inert"), false);
  assert.equal(tasksPage.querySelector("main.desktop-main")?.hasAttribute("inert"), true);
});

test("on a phone the places bar stands over the Tasks page though the task left behind it holds its panel open, which is not on screen", async () => {
  const page = await mountNarrow({
    boardView: { ...tasksControl().boardView, open: true },
    sidePanel: { ...tasksControl().sidePanel, open: true, fullScreen: true, fullScreenOnly: true },
  });
  assert.deepEqual(barItems(page).map(barName), ["Inbox", "Tasks", "Search", "New task"]);
});

/** What a reader hears an item named: its words, less what is drawn for the eye alone. */
function spokenName(item: HTMLElement): string {
  const heard = item.cloneNode(true) as HTMLElement;
  for (const unheard of heard.querySelectorAll('[aria-hidden="true"]')) unheard.remove();
  return heard.textContent ?? "";
}

test("on a phone the bar's Inbox wears the count of what needs the reader, named in the sidebar's words, and none at zero", async () => {
  // Note that main lists the three questions it counts, as its read of the account does.
  const asks = ["q-1", "q-2", "q-3"].map((id) => ({ id, agentId: "a-1", title: id, postedAt: 0 }));
  const listed = {
    tasks: [DOCUMENT_TASK],
    inbox: [{ taskId: DOCUMENT_TASK.id, items: asks }],
    inboxTasks: [{ taskId: DOCUMENT_TASK.id, items: 3, toDo: 3, updatedAt: 0 }],
  };
  const page = await mountNarrow(
    {
      boardView: { ...tasksControl().boardView, open: true },
      listed,
      inbox: listed.inbox,
      inboxTasks: listed.inboxTasks,
    },
    { overlay: SIDEBAR_OVERLAY.OPEN },
  );
  const inbox = barItems(page).find((item) => spokenName(item) === "Inbox, 3 need you");
  assert.ok(inbox, "the bar's Inbox is named with its count");
  assert.match(inbox.textContent ?? "", /3/u, "the Inbox's count is drawn");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const none = await mountNarrow({
    boardView: { ...tasksControl().boardView, open: true },
  });
  assert.deepEqual(
    barItems(none)
      .slice(0, 3)
      .map((item) => [spokenName(item), item.textContent]),
    [
      ["Inbox", "Inbox"],
      ["Tasks", "Tasks"],
      ["Search", "Search"],
    ],
    "nothing waiting, nothing is drawn or said",
  );
});

test("on a phone the Inbox's head leads with the reader's face, whose menu holds their workspaces and their account", async () => {
  const page = await mountNarrow({
    inboxView: { ...tasksControl().inboxView, open: true },
    workspaces: [ACME],
    workspace: ACME,
  });
  const face =
    page.querySelector<HTMLButtonElement>('.inbox-head button[aria-label="Account"]') ??
    assert.fail("the face leads the Inbox's head");
  act(() => face.click());
  const labels = [...document.querySelectorAll('[role="menu"] .ui-menu-item-label')].map(
    (each) => each.textContent,
  );
  for (const label of [ACME.name, "New workspace", "Settings", "Sign out"]) {
    assert.ok(labels.includes(label), `the menu offers ${label}`);
  }
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
      chosen: { taskId: "task-1", itemId: "item-1" },
    },
  });
  assert.deepEqual(barItems(onItem), [], "an item being read keeps the screen");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const onList = await mountNarrow({
    inboxView: { ...tasksControl().inboxView, open: true },
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
  mount(false, { boardView }, PANEL_TAB.SETTINGS, (tab) => went.push(tab));
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
  assert.ok((wait?.querySelectorAll(".ui-skeleton").length ?? 0) > 0);
  assert.equal(loading.querySelector("[role=switch]"), null, "their chunk has not loaded yet");
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS), "Automations' way out is offered");
  });

  assert.deepEqual(closed, ["closed"]);
});

test("while a version history's chunk is still loading, its Back row and Escape leave the history, as they do once it stands, and on a phone its list stands headed as it will be, by the way out and its title", async () => {
  const closed: string[] = [];
  const history = { ...tasksControl().history, open: true, onClose: () => closed.push("closed") };
  handState({});
  const page = mount(false, { history });
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
  act(() => root?.unmount());

  // Note that the chunk is still on its way, so the phone's frame is drawn in the same turn.
  const phone = drawLoadingNarrow(PANEL_TAB.TASKS, { history: { ...history, listed: true } }, true);
  assert.deepEqual(readPhoneHead(phone.page, "version-log"), {
    start: ["Back"],
    title: "Version history",
    end: [],
  });
  pressInPhoneHead(phone.page, "version-log", "Back");
  assert.deepEqual(phone.went, ["back"]);
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
  const page = mount(false, overrides);
  await settle();
  assert.ok(page.querySelector("section[aria-label=Automations]"));
  assert.equal(document.title, "Automations — Acme");
  assert.deepEqual(closed, [], "nothing closes it");
});

/** Every place in the window the developer can stand, as the shell is handed it. */
const PLACE = {
  HOME: "Home",
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

/** A draft agent's tab, which the column shows beside a panel. */
const DRAFT_TAB = { draft: "draft" };

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
    // Note that the panel fills the window over an agent's tab, since the task's details take its room.
    [PLACE.SIDE_PANEL_FULL_SCREEN]: {
      ...onTask,
      mainTabs: { ...control.mainTabs, tabs: [MAIN_TAB.OVERVIEW, DRAFT_TAB], tab: DRAFT_TAB },
      // The panel fills the window on a File tab of the plan.
      sidePanel: {
        ...control.sidePanel,
        open: true,
        fullScreen: true,
        strip: [{ file: "docs/notes.md" }],
        files: [
          { path: "docs/notes.md", range: undefined, opened: 0, browsedOn: DOCUMENT_TASK.id },
        ],
        tab: { file: "docs/notes.md" },
      },
    },
    [PLACE.SETTINGS]: { page: TASKS_PAGE.HOME },
    [PLACE.VERSION_HISTORY]: { ...onTask, history: { ...control.history, open: true } },
  } satisfies Record<Place, Partial<TasksControl>>;
  return {
    tab: place === PLACE.SETTINGS ? PANEL_TAB.SETTINGS : PANEL_TAB.TASKS,
    tasks: tasks[place],
  };
}

/** The shell standing in a place. */
function PlacedShell({
  place,
  patch,
}: {
  place: Place;
  /** What the tasks' state holds beyond the place's own. */
  patch?: Partial<TasksControl>;
}): React.JSX.Element {
  const placedIn = placed(place);
  const tab = placedIn.tab;
  const tasks = { ...placedIn.tasks, ...patch };
  return createElement(DesktopShell, {
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
      onLeaveRouted: ignore,
      away: undefined,
      onLeave: ignore,
    },
    sidebar: {
      collapsed: false,
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
}).filter((kind) => kind !== AGENT_ACT_KIND.AGENTS_SHOWN);

/**
 * The bridge as the window meets it, every act written down, and the chunks
 * of Settings and of the pages drawn on demand
 * (`pages-on-demand.ts`) already loaded, as each is once it has opened once,
 * so each stands within a settle.
 */
async function handBridge(experiments: ExperimentChoices = {}): Promise<void> {
  await Promise.all([
    import("./desktop-settings.js"),
    import("./desktop-version-history.js"),
    import("./person-page.js"),
  ]);
  handState(experiments);
  sentActs = [];
  const bridge = appBridge();
  fakeAppBridge({
    ...bridge,
  });
  fakeActPortAnswering((request) => {
    sentActs.push(request.kind);
    // A read of the account's automations, integrations, or its coding agents, or their Inbox, an account or settings act, a task kind, and the platform's updater, Browser tab, and window acts are refused.
    if (REFUSED_ON_PORT.includes(request.kind)) return Promise.reject(refusedOnPort("Not here."));
    return Promise.resolve(undefined);
  });
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
      root?.render(
        onRegistry(
          registry,
          underRouter(
            createElement(PlacedShell, { place }),
            place === PLACE.SETTINGS ? SHELL_AT.SETTINGS : undefined,
          ),
        ),
      ),
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

test("the side panel's toggle stands for the Inbox's chosen item", async () => {
  const control = tasksControl();
  const chosen = {
    inboxView: {
      ...control.inboxView,
      open: true,
      chosen: { taskId: DOCUMENT_TASK.id, itemId: "inbox-item-1" },
    },
  };
  await handBridge();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        underRouter(createElement(PlacedShell, { place: PLACE.INBOX, patch: chosen })),
      ),
    ),
  );
  await settle();
  const toggled = [...container.querySelectorAll("button")].some((button) =>
    ["Show panel", "Hide panel"].includes(button.getAttribute("aria-label") ?? ""),
  );
  act(() => root?.unmount());
  container.remove();
  assert.ok(toggled, "the toggle stands for the Inbox's chosen item");
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
        onRegistry(
          AtomRegistry.make(),
          underRouter(
            createElement(PlacedShell, { place }),
            place === PLACE.SETTINGS ? SHELL_AT.SETTINGS : undefined,
          ),
        ),
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
    [PLACE.HOME]: true,
    [PLACE.OTHER_TASK]: true,
    [PLACE.INBOX]: true,
    // Note that this agent is never read here, and an agent's page finds once its agent is drawn (`desktop-agent-page.test.ts`).
    [PLACE.AGENT_PAGE]: false,
    [PLACE.PERSON_PAGE]: true,
    [PLACE.AUTOMATIONS]: true,
    // Note that the panel filling the window holds the keys, and finds in the tab it shows.
    [PLACE.SIDE_PANEL_FULL_SCREEN]: true,
    [PLACE.SETTINGS]: false,
    [PLACE.VERSION_HISTORY]: true,
  });
});

test("a plan's chip in a plan's version history hangs the plan's card, as the plan's own words do", () => {
  const body = `## Rollout\n\nAs in [@the plan](https://vespin.dev/acme/plan/${DOCUMENT_TASK.id}).\n`;
  const control = tasksControl();
  const page = mount(false, {
    page: TASKS_PAGE.DOCUMENT,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    tasks: [DOCUMENT_TASK],
    history: {
      ...control.history,
      open: true,
      viewing: {
        line: {
          seq: 2,
          lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 0, duringCall: false },
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

  const card = document.querySelector(".ui-tooltip-card [data-task-card]");
  assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, DOCUMENT_NAME);
});

test("⌘K's Admin opens the Admin place for an admin alone, and is offered nothing for anyone else", async () => {
  let opened = 0;
  const adminView = { ...tasksControl().adminView, onOpen: () => (opened += 1) };
  handState({}, { access: { admin: false } });
  mount(false, { adminView });
  await settle();
  assert.equal(runAppCommand(APP_COMMAND.ADMIN), false);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handState({}, { access: { admin: true } });
  mount(false, { adminView });
  await settle();
  assert.equal(runAppCommand(APP_COMMAND.ADMIN), true);
  assert.equal(opened, 1);
});

test("Admin stands in the plan's place beside the sidebar, its row marked and no row of the place under it, with no way back of its own", async () => {
  handState({}, { access: { admin: true } });
  // Note that the Inbox stands under Admin, as the window's state holds it while Admin stands over it.
  const page = mount(true, { adminView: { ...tasksControl().adminView, open: true } });
  await settle();
  assert.ok(page.querySelector("aside.desktop-sidebar"), "the sidebar stays");
  // Note that the account's access lands through the app-state query, so its row is read once drawn.
  await vi.waitFor(() =>
    assert.equal(placeRow(page, "Admin")?.getAttribute("aria-current"), "page"),
  );
  assert.equal(placeRow(page, "Inbox")?.getAttribute("aria-current") ?? null, null);
  const main = page.querySelector(".desktop-main") ?? assert.fail("the work column");
  assert.ok(main.querySelector("section[aria-label=Admin]"), "Admin stands in the plan's place");
  assert.deepEqual(
    [...main.querySelectorAll("button")].filter((button) =>
      /^Back\b/u.test(button.getAttribute("aria-label") ?? button.textContent ?? ""),
    ),
    [],
  );
});

/** The offline status in the title bar beside the traffic lights, if one stands. */
function titleBarOffline(page: HTMLElement): Element | null {
  return page.querySelector('.title-bar-controls .offline-mark[aria-label="Offline"]');
}

test("with the sidebar folded, the Mac offline says so in the title bar beside New task, and nothing does online", async () => {
  handState({}, { network: { online: false, reachable: true } });
  const offline = mount(false);
  await settle();
  assert.ok(titleBarOffline(offline), "the title bar says the Mac is offline");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handState({}, { network: { online: true, reachable: true } });
  const online = mount(false);
  await settle();
  assert.equal(titleBarOffline(online), null);
});

/** What a strip right under a phone's header says, if one stands there. */
function stripUnderPhoneHead(page: HTMLElement): string | undefined {
  const under = page.querySelector('header.ui-toolbar[data-look="phone"]')?.nextElementSibling;
  return under?.classList.contains("ui-banner") === true ? (under.textContent ?? "") : undefined;
}

test("on a phone, the service not answering says so in a strip under the page's header, and nothing does once it answers", async () => {
  const inboxView = { ...tasksControl().inboxView, open: true };
  handState({}, { network: { online: true, reachable: false } });
  const unreached = await mountNarrow({ inboxView });
  assert.equal(stripUnderPhoneHead(unreached), "The service isn't answering.");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handState({}, { network: { online: true, reachable: true } });
  const answering = await mountNarrow({ inboxView });
  assert.ok(
    answering.querySelector('header.ui-toolbar[data-look="phone"]'),
    "a phone's header stands",
  );
  assert.equal(stripUnderPhoneHead(answering), undefined);
});

test("the sign-in, which needs the network, says over it when the Mac is offline", async () => {
  handState({}, { network: { online: false, reachable: true } });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const props = shellProps(tasksControl(), PANEL_TAB.TASKS, ignore, {});
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        underRouter(
          createElement(DesktopShell, {
            ...props,
            gates: { ...props.gates, accountRequired: true },
            settings: { ...SETTINGS, account: { status: ACCOUNT_STATUS.SIGNED_OUT } },
          }),
        ),
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
          underRouter(
            createElement(DesktopShell, {
              ...props,
              history: { ...props.history, away, onLeave: () => left.push("left") },
              room,
            }),
          ),
        ),
      ),
    );
    return container;
  };
  const back = (page: HTMLElement) =>
    page.querySelector<HTMLButtonElement>(".task-head .ui-toolbar-lead button") ??
    assert.fail("a way back");

  const fromInbox = render({ title: { label: "Inbox" } }, SHELL_ROOM.NARROW);
  await settle();
  assert.equal(back(fromInbox).textContent, "Inbox");
  assert.equal(fromInbox.querySelector(".desktop-shell > .title-bar-controls"), null);
  act(() => back(fromInbox).click());
  assert.deepEqual(left, ["left"]);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const fromNowhere = render(undefined, SHELL_ROOM.NARROW);
  await settle();
  assert.equal(back(fromNowhere).textContent, "Home", "with no page behind, Home");
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
        underRouter(
          createElement(DesktopShell, {
            ...shellProps(tasks, PANEL_TAB.TASKS, ignore, { onToggle: () => (toggled += 1) }),
            room: SHELL_ROOM.NARROW,
          }),
        ),
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

test("on a phone's task, which stands over no places bar, a finger swiped in from the screen's left edge opens the drawer over a dimmed window, and a mouse's drag does not", async () => {
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
    {
      page: TASKS_PAGE.DOCUMENT,
      region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    },
    { onOverlay },
  );
  const work = page.querySelector<HTMLElement>(".desktop-main");
  assert.ok(work);
  fingerSwipe(work, 300, 500, "mouse");
  assert.deepEqual(asked, [], "a mouse's drag opens nothing");
  fingerSwipe(work, 30, 260);
  assert.deepEqual(asked, [SIDEBAR_OVERLAY.OPEN]);
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

/** Whether a reader is shown `element`: nothing over it hides it, as a box drawn with `display: none` is hidden from the screen and the accessibility tree alike. */
function shownToReader(element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if (at.hasAttribute("hidden") || getComputedStyle(at).display === "none") return false;
  }
  return true;
}

test("the Inbox left stays drawn, hidden from a reader, and comes back as it stood, and the Tasks page left comes back on the view it stood on", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let setOpen: (open: { inbox: boolean; board: boolean }) => void = ignore;
  function Shell() {
    const [open, setPlaceOpen] = useState({ inbox: true, board: false });
    setOpen = setPlaceOpen;
    const tasks = tasksControl({
      page: TASKS_PAGE.HOME,
      workspaces: [ACME],
      workspace: ACME,
      inboxView: { ...tasksControl().inboxView, open: open.inbox },
      boardView: { ...tasksControl().boardView, open: open.board },
    });
    return createElement(DesktopShell, shellProps(tasks, PANEL_TAB.TASKS, ignore, {}));
  }
  // The Board is the router's place, which the window moves to as it opens and off as it is left.
  const stand = async (open: { inbox: boolean; board: boolean }) => {
    act(() => {
      setOpen(open);
      routed().go(open.board ? SHELL_AT.BOARD : SHELL_AT.PLACES);
    });
    await act(() => routed().settled());
    await settle();
  };
  act(() => root?.render(onRegistry(AtomRegistry.make(), underRouter(createElement(Shell)))));
  const search = () =>
    container.querySelector<HTMLInputElement>('.inbox-tasks input[aria-label="Search inbox"]');
  const input = search();
  assert.ok(input, "the Inbox's search stands");
  // Note that the value goes in through the prototype's setter, because React tracks the field's own.
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "zzz");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await stand({ inbox: false, board: true });
  assert.equal(search(), input, "the Inbox left is the same Inbox, kept");
  assert.equal(shownToReader(input), false, "and hidden from a reader while the window is away");
  const columns = () =>
    [...container.querySelectorAll<HTMLElement>('[aria-label="Tasks view"] [role="radio"]')].find(
      (each) => each.textContent?.trim() === "Columns",
    );
  act(() => columns()?.click());
  assert.equal(columns()?.getAttribute("aria-checked"), "true", "the Tasks page stands on Columns");

  await stand({ inbox: false, board: false });
  assert.equal(columns(), undefined, "the Tasks page left is let go");

  await stand({ inbox: false, board: true });
  assert.equal(columns()?.getAttribute("aria-checked"), "true", "and comes back on its view");

  await stand({ inbox: true, board: false });
  assert.equal(shownToReader(input), true);
  assert.equal(search()?.value, "zzz", "the Inbox's search as it stood");
});
