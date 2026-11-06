// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { EXPERIMENT } from "@repo/settings";
import { MICROPHONE_STATUS } from "@repo/settings/microphone";
import { NOTIFICATIONS_STATUS } from "@repo/settings/settings-controls";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { experimentsOn } from "@repo/settings/testing";
import { UPDATE_STATUS } from "@repo/settings/update";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import type { SettingsPanelProps } from "../settings/settings-panel.js";
import { useStageRoom } from "../stage-room.js";
import { MAIN_TAB } from "../tasks/use-main-tabs.js";
import { useSidePanel } from "../tasks/use-side-panel.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, registryWith } from "../testing/app-state.js";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { relayout } from "../testing/resize-observer.js";
import { shellRouterEachTest } from "../testing/shell-router.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopShell } from "./desktop-shell.js";
import { useSidebarCollapse } from "./sidebar-collapse.js";

const ignore = () => undefined;
const _accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });

const SETTINGS: SettingsPanelProps = {
  account: {
    status: ACCOUNT_STATUS.SIGNED_IN,
    email: "dev@example.com",
    name: "Dev",
    provider: "github",
  },
  onSignOut: () => Promise.resolve(),
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

const OPEN_TASK = { id: DOCUMENT_TASK.id, holds: {} };

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const WIDE = 1280;

const PHONE = 390;

let root: Root | undefined;

let stageWidth = 0;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    "app.sidePanel",
    JSON.stringify({
      open: true,
      tabs: ["plan", "inbox", "comments"],
      tab: { changes: AGENT },
      width: 400,
      tasks: {
        [DOCUMENT_TASK.id]: { opened: [], closed: [], changes: [{ changes: AGENT }] },
      },
    }),
  );
  fakeAppPlatform(QUIET_PANEL);
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
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const routed = shellRouterEachTest();

function underRouter(shell: ReactElement, standing?: string): ReactElement {
  return routed().under(shell, standing);
}

function resizeStage(width: number): void {
  stageWidth = width;
  act(() => relayout());
}

function Window({ onTask }: { onTask: boolean }): React.JSX.Element {
  const stage = useStageRoom();
  const room = stage.room;
  const sidebar = useSidebarCollapse(false, stage.compact);
  const sidePanel = useSidePanel(undefined, OPEN_TASK, [AGENT], [], [], [AGENT], room);
  const [tab, setTab] = useState<PanelTab>(PANEL_TAB.TASKS);
  const shell = createElement(DesktopShell, {
    gates: { accountRequired: false, onBeginSignIn: ignore, onCancelSignIn: ignore },
    tab,
    onTabChange: setTab,
    tasks: tasksControl({
      page: onTask ? TASKS_PAGE.DOCUMENT : TASKS_PAGE.HOME,
      tasks: [DOCUMENT_TASK],
      region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
      mainTabs: {
        ...tasksControl().mainTabs,
        tabs: [MAIN_TAB.OVERVIEW, { draft: "draft" }],
        tab: { draft: "draft" },
      },
      sidePanel,
    }),
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
    sidebar,
    room,
    settingsStep: { listed: true, onList: ignore },
    settings: SETTINGS,
  });
  return createElement("div", { ref: stage.ref, className: "app-stage" }, shell);
}

function mount(width: number, onTask = true): HTMLElement {
  stageWidth = width;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: this.classList.contains("app-stage") ? stageWidth : 0 });
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS)),
        underRouter(createElement(Window, { onTask })),
      ),
    ),
  );
  return container;
}

function roomOf(page: HTMLElement): string | null | undefined {
  return page.querySelector(".desktop-shell")?.getAttribute("data-room");
}

function sidebarToggle(page: HTMLElement): HTMLButtonElement {
  const button = page.querySelector<HTMLButtonElement>(
    ".title-bar-controls:not([data-edge]) button",
  );
  assert.ok(button, "the sidebar's toggle stands");
  return button;
}

function openDrawer(): void {
  act(() => runAppCommand(APP_COMMAND.TOGGLE_SIDEBAR));
}

function panelToggle(page: HTMLElement): HTMLButtonElement {
  const button = page.querySelector<HTMLButtonElement>(
    '.title-bar-controls[data-edge="end"] button',
  );
  assert.ok(button, "the panel's toggle stands");
  return button;
}

function panelOf(page: HTMLElement) {
  const aside = page.querySelector<HTMLElement>("aside.side-panel");
  assert.ok(aside, "the panel is drawn");
  return {
    fullScreen: aside.getAttribute("data-full-screen") === "true",
    resizable: aside.querySelector('[aria-label="Resize panel"]') !== null,
    fullScreenButton: [...aside.querySelectorAll("button")].some((button) =>
      ["Expand panel", "Exit full screen"].includes(button.getAttribute("aria-label") ?? ""),
    ),
  };
}

function sidebarOf(page: HTMLElement): HTMLElement {
  return (
    page.querySelector<HTMLElement>("aside.desktop-sidebar") ?? assert.fail("the sidebar is drawn")
  );
}

function sidebarStanding(page: HTMLElement): string {
  const shell = page.querySelector(".desktop-shell");
  if (shell?.getAttribute("data-sidebar-collapsed") === "false") return "pinned";
  return shell?.getAttribute("data-sidebar-overlay") === "open" ? "drawer" : "away";
}

test("a stage narrowed below 640 stands the window as one pane, and only at 672 is it wide again", () => {
  const page = mount(WIDE);
  assert.equal(roomOf(page), "wide");

  resizeStage(660);
  assert.equal(roomOf(page), "wide", "a stage above the line is still wide");
  resizeStage(639);
  assert.equal(roomOf(page), "narrow");
  resizeStage(671);
  assert.equal(roomOf(page), "narrow", "a stage widened within the band stays narrow");
  resizeStage(672);
  assert.equal(roomOf(page), "wide");
  resizeStage(650);
  assert.equal(roomOf(page), "wide", "a stage narrowed within the band stays wide");
});

const ZOOMED_LEAST_WINDOW = [
  { zoom: 125, width: 608 },
  { zoom: 200, width: 380 },
] as const;

for (const { zoom, width } of ZOOMED_LEAST_WINDOW) {
  test(`the least desktop window at ${zoom}% zoom, ${width} CSS px under a mouse, stands as one pane with a drawer, and unzoomed it is wide again`, () => {
    const page = mount(width);
    assert.equal(roomOf(page), "narrow");
    assert.deepEqual(panelOf(page), {
      fullScreen: true,
      resizable: false,
      fullScreenButton: false,
    });
    assert.equal(
      page.querySelector(".desktop-shell > .title-bar-controls"),
      null,
      "the task's header stands for the sidebar's toggle",
    );

    resizeStage(760);
    assert.equal(roomOf(page), "wide", "the same window unzoomed is wide");
    assert.equal(
      panelOf(page).fullScreen,
      false,
      "the panel stands beside the document once the room is wide",
    );
  });

  test(`the sidebar at ${zoom}% zoom, ${width} CSS px, is a drawer that the sidebar's chord opens`, () => {
    const page = mount(width, false);
    assert.equal(roomOf(page), "narrow");
    assert.equal(sidebarStanding(page), "away");
    openDrawer();
    assert.equal(sidebarStanding(page), "drawer");
  });
}

function headBack(page: HTMLElement): HTMLButtonElement {
  const back = page.querySelector<HTMLButtonElement>(".task-head .ui-toolbar-lead button");
  assert.ok(back, "the task's header leads with its way back");
  return back;
}

test("an open side panel on a narrow stage fills the window, with no edge to drag and no full-screen button, the task's header standing for its toggle and the sidebar's", () => {
  const page = mount(PHONE);
  assert.equal(roomOf(page), "narrow");
  assert.deepEqual(panelOf(page), { fullScreen: true, resizable: false, fullScreenButton: false });
  assert.equal(
    page.querySelector('.title-bar-controls[data-edge="end"]'),
    null,
    "the header stands for the toggle",
  );
  assert.equal(
    page.querySelector(".desktop-shell > .title-bar-controls"),
    null,
    "the header's way back stands for the sidebar's toggle and New task",
  );
  assert.equal(headBack(page).getAttribute("aria-label"), "Back to New agent");

  resizeStage(WIDE);
  assert.deepEqual(
    panelOf(page),
    { fullScreen: false, resizable: true, fullScreenButton: true },
    "a stage widened again hands the panel back beside the document",
  );
  assert.equal(panelToggle(page).getAttribute("aria-label"), "Hide panel");
  assert.equal(page.querySelector(".task-head"), null, "a wide stage draws no header of its own");

  resizeStage(PHONE);
  act(() => headBack(page).click());
  assert.equal(
    page.querySelector("aside.side-panel") === null,
    true,
    "the way back shuts the panel",
  );
  assert.equal(
    headBack(page).getAttribute("aria-label"),
    `Back to ${DOCUMENT_TASK.name}`,
    "over the column's draft, whose way back leads to the task's details",
  );
});

test("the sidebar on a narrow stage is a drawer: no edge peeks it out and no title bar's toggle stands, the sidebar's chord opens it over the work, and a press outside puts it away", () => {
  const sheets = layContainersAt({});
  const page = mount(PHONE, false);
  const shell = page.querySelector(".desktop-shell") ?? assert.fail("the shell stands");
  assert.deepEqual(
    [getComputedStyle(shell).gridTemplateColumns, getComputedStyle(sidebarOf(page)).position],
    ["minmax(0, 1fr)", "absolute"],
    "the drawer stands out of the shell's columns, leaving the work the whole stage",
  );
  assert.equal(sidebarStanding(page), "away");
  assert.equal(
    page.querySelector("[data-sidebar-peek-edge]"),
    null,
    "no edge waits for a pointer a phone does not have",
  );

  assert.equal(
    page.querySelector(".desktop-shell > .title-bar-controls"),
    null,
    "a phone's page heads itself, so no toggle stands over it",
  );
  openDrawer();
  assert.equal(sidebarStanding(page), "drawer");

  const main = page.querySelector("main.desktop-main");
  assert.ok(main);
  act(() => {
    main.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  assert.equal(sidebarStanding(page), "away");

  resizeStage(WIDE);
  assert.equal(sidebarStanding(page), "pinned", "the desktop's width pins it as before");
  assert.deepEqual(
    [getComputedStyle(shell).gridTemplateColumns, getComputedStyle(sidebarOf(page)).position],
    ["var(--sidebar-width) minmax(0, 1fr)", "relative"],
    "pinned, it takes its column beside the work again",
  );
  sheets.remove();
});

test("a phone's drawer is modal: while it stands over the work, the work is inert, and put away it answers again", () => {
  const page = mount(PHONE, false);
  const main = page.querySelector<HTMLElement>("main.desktop-main") ?? assert.fail("the work");
  assert.equal(main.hasAttribute("inert"), false, "with the drawer away the work answers");

  openDrawer();
  assert.equal(sidebarStanding(page), "drawer");
  assert.equal(main.hasAttribute("inert"), true, "the work behind the drawer is inert");

  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(sidebarStanding(page), "away", "Escape puts it away");
  assert.equal(main.hasAttribute("inert"), false);
});

test("beside the work an open floating sidebar leaves the work answering, as it did", () => {
  const page = mount(WIDE);
  resizeStage(900);
  act(() => sidebarToggle(page).click());
  assert.equal(sidebarStanding(page), "drawer");
  const main = page.querySelector<HTMLElement>("main.desktop-main") ?? assert.fail("the work");
  assert.equal(main.hasAttribute("inert"), false);
});

function historyArrows(page: HTMLElement): boolean {
  return page.querySelector('.title-bar-controls[data-edge="column"]') !== null;
}

test("a phone draws no Back and Forward in the drawer's head; a wide window keeps them", () => {
  const page = mount(PHONE, false);
  openDrawer();
  assert.equal(historyArrows(page), false);

  resizeStage(WIDE);
  assert.equal(historyArrows(page), true);
});

test("Escape puts a phone's drawer away and gives the keyboard back to the work it was opened from", () => {
  const focus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    if (this.closest("[inert]") !== null) return;
    focus.call(this, options);
  });
  const page = mount(PHONE, false);
  const work =
    page.querySelector<HTMLElement>("main.desktop-main button:not([disabled])") ??
    assert.fail("the work holds a button");
  work.focus();

  openDrawer();
  assert.equal(sidebarStanding(page), "drawer");
  const held = document.activeElement;
  assert.ok(
    held instanceof HTMLElement && sidebarOf(page).contains(held),
    "the drawer takes the keyboard",
  );

  act(() => {
    held.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(sidebarStanding(page), "away");
  assert.ok(document.activeElement === work, "the keyboard is back where it was");
});
