// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { runAppCommand } from "@luke/panel/app-commands";
import { PANEL_TAB, type PanelTab } from "@luke/panel/panel-tabs";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { DESKTOP_CAPABILITIES } from "@luke/panel/testing/app-state";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { UPDATE_STATUS } from "@luke/settings/update";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { tasksControl } from "#testing/tasks-control";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { DesktopShell } from "./desktop-shell";
import { useSidebarCollapse } from "./sidebar-collapse";

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

/** The sidebar fold the developer chose, as storage keeps it. */
const KEPT_FOLD = "luke.sidebar-collapsed";

let root: Root | undefined;

beforeEach(() => {
  window.localStorage.clear();
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
  document.body.innerHTML = "";
});

/** Resizes the window, as the developer dragging its frame does. */
function resizeWindow(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

/** The window's shell on the home page at a width, its sidebar the real fold kept in storage. */
function mount(width: number, onGoHome: () => void = ignore): HTMLElement {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Window() {
    const sidebar = useSidebarCollapse(false);
    const [tab, setTab] = useState<PanelTab>(PANEL_TAB.TASKS);
    return createElement(DesktopShell, {
      gates: {
        accountRequired: false,
        onBeginSignIn: ignore,
        onCancelSignIn: ignore,
      },
      tab,
      onTabChange: setTab,
      tasks: tasksControl({ page: TASKS_PAGE.HOME, onGoHome }),
      history: {
        canGoBack: false,
        canGoForward: false,
        onBack: ignore,
        onForward: ignore,
        onLeaveVersionHistory: ignore,
      },
      sidebar,
      call: undefined,
      captions: {
        caption: { content: undefined, shown: false },
        volumeHint: { wanted: false, text: "", onDismiss: ignore },
      },
      settings: SETTINGS,
    });
  }
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Window))));
  return container;
}

function sidebarOf(page: HTMLElement): HTMLElement {
  const aside = page.querySelector<HTMLElement>("aside.desktop-sidebar");
  assert.ok(aside, "the sidebar is drawn");
  return aside;
}

/**
 * How the sidebar stands, as the developer meets it: `pinned` beside the
 * work, `away` folded off the window and unreachable, `floating` over the
 * work and reachable.
 */
function standing(page: HTMLElement): string {
  const aside = sidebarOf(page);
  const folded = page.querySelector(".desktop-shell")?.getAttribute("data-sidebar-collapsed");
  if (folded === "false") return "pinned";
  return aside.hasAttribute("inert") ? "away" : "floating";
}

/** The sidebar's toggle beside the traffic lights, by whatever it is called now. */
function toggle(page: HTMLElement): HTMLButtonElement {
  const button = page.querySelector<HTMLButtonElement>(
    ".title-bar-controls:not([data-edge]) button",
  );
  assert.ok(button, "the toggle stands");
  return button;
}

/** A press as it starts down, which the window hears before the click. */
function pressDown(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  });
}

/** The pointer crossing from `from` onto `to`, as React hears an enter and a leave. */
function pointerCross(from: Element, to: Element): void {
  act(() => {
    from.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: from }));
  });
}

/** The sidebar's row named `name`: the button whose first words a reader hears are it. */
function rowNamed(within: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      [...button.children].find((part) => part.getAttribute("aria-hidden") !== "true")
        ?.textContent === name,
  );
}

test("a window narrowed past the line folds the pinned sidebar without forgetting it: within the band it stays as it is, and widened past it the sidebar is pinned again", () => {
  const page = mount(1450);
  assert.equal(standing(page), "pinned");
  assert.ok(sidebarOf(page).querySelector('[role="separator"]'), "a pinned sidebar has its edge");

  resizeWindow(1100);
  assert.equal(standing(page), "away");
  assert.equal(toggle(page).getAttribute("aria-label"), "Show sidebar");
  resizeWindow(1140);
  assert.equal(standing(page), "away", "a window dragged back within the band does not unfold it");
  resizeWindow(1170);
  assert.equal(standing(page), "pinned");
  resizeWindow(1130);
  assert.equal(standing(page), "pinned", "a window dragged back within the band does not fold it");
  assert.equal(window.localStorage.getItem(KEPT_FOLD), "false", "the fold kept is the developer's");
});

test("a sidebar the developer folded stays folded across a narrowing and a widening", () => {
  const page = mount(1450);
  act(() => toggle(page).click());
  assert.equal(standing(page), "away");
  resizeWindow(900);
  resizeWindow(1450);
  assert.equal(standing(page), "away");
  assert.equal(window.localStorage.getItem(KEPT_FOLD), "true");
});

test("in a narrow window the toggle and its chord float the sidebar over the work, never pinning it, with no edge to drag; it takes the keyboard at its marked row, and Escape puts it away and gives the keyboard back", () => {
  const page = mount(1000);
  const button = toggle(page);
  button.focus();
  act(() => button.click());
  assert.equal(standing(page), "floating");
  assert.equal(button.getAttribute("aria-label"), "Hide sidebar");
  assert.equal(sidebarOf(page).querySelector('[role="separator"]'), null);
  assert.ok(
    document.activeElement === rowNamed(sidebarOf(page), "Home"),
    "the keyboard lands on the place shown",
  );

  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  assert.equal(standing(page), "away");
  assert.ok(document.activeElement === button, "the keyboard is back where it was");

  act(() => runAppCommand(APP_COMMAND.TOGGLE_SIDEBAR));
  assert.equal(standing(page), "floating");
  act(() => runAppCommand(APP_COMMAND.TOGGLE_SIDEBAR));
  assert.equal(standing(page), "away", "the chord puts it away rather than pinning it");
  assert.equal(window.localStorage.getItem(KEPT_FOLD), "false");
});

test("a sidebar its toggle floats in a narrow window holds the keyboard: Tab walking out of it is brought back, until Escape hands it back", () => {
  const page = mount(1000);
  const button = toggle(page);
  const work = page.querySelector<HTMLButtonElement>("main.desktop-main button");
  assert.ok(work, "the work offers a press to hold the keyboard");
  button.focus();
  act(() => button.click());
  const home = rowNamed(sidebarOf(page), "Home");
  assert.ok(document.activeElement === home, "the keyboard lands on the place shown");

  // jsdom walks no focus for Tab, so the walk out is the key, then the focus it lands.
  act(() => {
    home?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    work.focus();
  });
  assert.ok(document.activeElement === home, "the keyboard is brought back into the sidebar");

  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  assert.equal(standing(page), "away");
  assert.ok(document.activeElement === button, "Escape hands the keyboard back");
});

test("the floating sidebar stays for a press inside it and goes at a press outside it, or once a choice in it is made", () => {
  let home = 0;
  const page = mount(1000, () => (home += 1));
  act(() => toggle(page).click());
  pressDown(sidebarOf(page).querySelector(".sidebar-rule") ?? sidebarOf(page));
  assert.equal(standing(page), "floating");
  pressDown(toggle(page));
  assert.equal(standing(page), "floating", "its own toggle is no press outside it");
  pressDown(page.querySelector("main.desktop-main") ?? page);
  assert.equal(standing(page), "away");

  act(() => toggle(page).click());
  const homeRow = rowNamed(sidebarOf(page), "Home");
  assert.ok(homeRow);
  act(() => homeRow.click());
  assert.deepEqual([home, standing(page)], [1, "away"]);
});

test("the pointer at the window's left edge peeks the folded sidebar out, which goes once the pointer leaves it, a press in it or not, as Linear's does; a wide window's toggle pins it from a peek", () => {
  const page = mount(1000);
  const main = page.querySelector("main.desktop-main");
  assert.ok(main);
  const edge = () => {
    const strip = page.querySelector("[data-sidebar-peek-edge]");
    assert.ok(strip, "a folded sidebar's edge waits for the pointer");
    return strip;
  };
  pointerCross(main, edge());
  assert.equal(standing(page), "floating");
  assert.equal(toggle(page).getAttribute("aria-label"), "Show sidebar", "a peek is not yet open");
  pointerCross(sidebarOf(page), main);
  assert.equal(standing(page), "away");

  pointerCross(main, edge());
  pressDown(sidebarOf(page));
  assert.equal(standing(page), "floating", "a press in a peek is no press outside it");
  pointerCross(sidebarOf(page), main);
  assert.equal(standing(page), "away", "a press keeps no peek open");

  resizeWindow(1450);
  act(() => toggle(page).click());
  assert.equal(standing(page), "away");
  pointerCross(main, edge());
  assert.equal(standing(page), "floating");
  act(() => toggle(page).click());
  assert.equal(standing(page), "pinned");
});

test("a floating sidebar left for Settings by its chord is away when the plans come back", async () => {
  const page = mount(1000);
  act(() => toggle(page).click());
  assert.equal(standing(page), "floating");
  act(() => runAppCommand(APP_COMMAND.SETTINGS));
  // Settings is its own chunk, so the test waits for it as the window does.
  await act(async () => {
    await import("./desktop-settings");
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  assert.equal(page.querySelector("aside.desktop-sidebar"), null, "Settings draws its own list");
  const back = rowNamed(page.querySelector('nav[aria-label="Settings pages"]') ?? page, "Back");
  assert.ok(back, "Settings has its way back");
  act(() => back.click());
  assert.equal(standing(page), "away");
});

test("Escape puts a peek away while the keyboard stays in the work under it, and the window's layers beneath do not hear it", () => {
  const page = mount(1000);
  const main = page.querySelector("main.desktop-main");
  const edge = page.querySelector("[data-sidebar-peek-edge]");
  assert.ok(main && edge);
  const work = main.querySelector<HTMLButtonElement>("button");
  assert.ok(work, "the work offers a press to hold the keyboard");
  work.focus();
  pointerCross(main, edge);
  assert.equal(standing(page), "floating");
  const press = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    work.dispatchEvent(press);
  });
  assert.deepEqual([standing(page), press.defaultPrevented], ["away", true]);
});

test("a dialog raised from the open sidebar takes Escape first, leaving the sidebar open behind it", () => {
  const page = mount(1000);
  act(() => toggle(page).click());
  const dialog = document.body.appendChild(document.createElement("div"));
  dialog.setAttribute("role", "dialog");
  const field = dialog.appendChild(document.createElement("button"));
  field.focus();
  const press = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    field.dispatchEvent(press);
  });
  assert.deepEqual([standing(page), press.defaultPrevented], ["floating", false]);
});

test("a press on no control in a peek keeps the keyboard in the work, and Escape there still puts it away", () => {
  const page = mount(1000);
  const main = page.querySelector("main.desktop-main");
  const edge = page.querySelector("[data-sidebar-peek-edge]");
  const work = main?.querySelector<HTMLButtonElement>("button");
  assert.ok(main && edge && work);
  work.focus();
  pointerCross(main, edge);
  pressDown(sidebarOf(page).querySelector(".sidebar-rule") ?? sidebarOf(page));
  assert.equal(standing(page), "floating");
  assert.ok(document.activeElement === work, "the keyboard stays in the work");
  const press = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    work.dispatchEvent(press);
  });
  assert.deepEqual([standing(page), press.defaultPrevented], ["away", true]);
});
