// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { UPDATE_STATUS } from "@luke/settings/update";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import type { SettingsPanelProps } from "../settings/settings-panel.js";
import { useShellRoom } from "../shell-room.js";
import { useStageWidth } from "../stage-width.js";
import { SIDE_PANEL_TAB, useSidePanel } from "../tasks/use-side-panel.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { relayout } from "../testing/resize-observer.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopShell } from "./desktop-shell.js";
import { useSidebarCollapse } from "./sidebar-collapse.js";

/**
 * shell-room.test.ts -- the window on a stage as narrow as a phone's stands
 * as one pane at a time: the sidebar a drawer its toggle opens and a press
 * outside puts away, and the side panel only full screen, with no edge to
 * drag and a toggle that reads Close. A stage as wide as the desktop's
 * window keeps both as they were. Synthetic task, no account of anyone's.
 */

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
  shortcuts: {
    voiceHotkeyHeld: false,
    voiceChosen: false,
    voiceOff: false,
    onVoiceHotkeyChange: accepted,
    stopChosen: false,
    stopOff: false,
    onStopHotkeyChange: accepted,
    onCapture: ignore,
  },
};

/** The task open in the window, holding a board, so its panel has a tab to show. */
const OPEN_TASK = { id: DOCUMENT_TASK.id, holds: { [SIDE_PANEL_TAB.BOARD]: true } };

/** The desktop's window at its usual width. */
const WIDE = 1280;

/** A phone's width. */
const PHONE = 390;

let root: Root | undefined;

/** How wide the panel's stage is laid out, which jsdom, laying out nothing, leaves to the test. */
let stageWidth = 0;

beforeEach(() => {
  window.localStorage.clear();
  fakeAppPlatform(QUIET_PANEL);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** Resizes the panel's stage, as a phone turned or a browser window dragged does. */
function resizeStage(width: number): void {
  stageWidth = width;
  act(() => relayout());
}

/** The window as the panel's root draws it: the stage measured, its room, and the real sidebar and side panel over the task open on its page. */
function Window(): React.JSX.Element {
  const stage = useStageWidth();
  const room = useShellRoom(stage.width);
  const sidebar = useSidebarCollapse(false, stage.width);
  const sidePanel = useSidePanel(undefined, OPEN_TASK, undefined, [], [], [], undefined, room);
  const [tab, setTab] = useState<PanelTab>(PANEL_TAB.TASKS);
  const shell = createElement(DesktopShell, {
    gates: { accountRequired: false, onBeginSignIn: ignore, onCancelSignIn: ignore },
    tab,
    onTabChange: setTab,
    tasks: tasksControl({
      page: TASKS_PAGE.DOCUMENT,
      region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
      sidePanel,
    }),
    history: {
      canGoBack: false,
      canGoForward: false,
      onBack: ignore,
      onForward: ignore,
      onLeaveVersionHistory: ignore,
    },
    sidebar,
    room,
    call: undefined,
    captions: {
      caption: { content: undefined, shown: false },
      volumeHint: { wanted: false, text: "", onDismiss: ignore },
    },
    settings: SETTINGS,
  });
  return createElement("div", { ref: stage.ref, className: "app-stage" }, shell);
}

/** The window on a stage of a width, the open task's page drawn. */
function mount(width: number): HTMLElement {
  stageWidth = width;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: this.classList.contains("app-stage") ? stageWidth : 0 });
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Window))));
  return container;
}

/** The room the shell stands in, as the stylesheet reads it. */
function roomOf(page: HTMLElement): string | null | undefined {
  return page.querySelector(".desktop-shell")?.getAttribute("data-room");
}

/** The sidebar's toggle at the window's top left, by whatever it is called now. */
function sidebarToggle(page: HTMLElement): HTMLButtonElement {
  const button = page.querySelector<HTMLButtonElement>(
    ".title-bar-controls:not([data-edge]) button",
  );
  assert.ok(button, "the sidebar's toggle stands");
  return button;
}

/** The side panel's toggle at the window's top right, by whatever it is called now. */
function panelToggle(page: HTMLElement): HTMLButtonElement {
  const button = page.querySelector<HTMLButtonElement>(
    '.title-bar-controls[data-edge="end"] button',
  );
  assert.ok(button, "the panel's toggle stands");
  return button;
}

/** The side panel as it is drawn: whether it fills the window, can be dragged, and offers full screen. */
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

/** How the sidebar stands: `away` out of reach, `drawer` floating over the work, or `pinned` beside it. */
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

test("an open side panel on a narrow stage fills the window, with no edge to drag and no full-screen button, and its toggle reads Close", () => {
  const page = mount(PHONE);
  assert.equal(roomOf(page), "narrow");
  assert.equal(page.querySelector("aside.side-panel"), null, "the panel starts shut");

  act(() => panelToggle(page).click());
  assert.deepEqual(panelOf(page), { fullScreen: true, resizable: false, fullScreenButton: false });
  assert.equal(panelToggle(page).getAttribute("aria-label"), "Close");

  resizeStage(WIDE);
  assert.deepEqual(
    panelOf(page),
    { fullScreen: false, resizable: true, fullScreenButton: true },
    "a stage widened again hands the panel back beside the document",
  );
  assert.equal(panelToggle(page).getAttribute("aria-label"), "Hide panel");

  resizeStage(PHONE);
  act(() => panelToggle(page).click());
  assert.equal(page.querySelector("aside.side-panel"), null, "Close shuts the panel");
  assert.equal(panelToggle(page).getAttribute("aria-label"), "Show panel");
});

test("the sidebar on a narrow stage is a drawer: no edge peeks it out, its toggle opens it over the work, and a press outside puts it away", () => {
  const page = mount(PHONE);
  assert.equal(sidebarStanding(page), "away");
  assert.equal(
    page.querySelector("[data-sidebar-peek-edge]"),
    null,
    "no edge waits for a pointer a phone does not have",
  );

  act(() => sidebarToggle(page).click());
  assert.equal(sidebarStanding(page), "drawer");
  assert.equal(sidebarToggle(page).getAttribute("aria-label"), "Hide sidebar");

  const main = page.querySelector("main.desktop-main");
  assert.ok(main);
  act(() => {
    main.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  assert.equal(sidebarStanding(page), "away");

  resizeStage(WIDE);
  assert.equal(sidebarStanding(page), "pinned", "the desktop's width pins it as before");
});
