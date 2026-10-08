// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { plansControl } from "#testing/plans-control";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { DesktopShell } from "./desktop-shell";
import { useSidebarCollapse } from "./sidebar-collapse";

const ignore = () => undefined;

/** The window as `App` stands it: the shell over the collapse, whose chord answers on Plans alone. */
function Window({ tab }: { tab: PanelTab }): React.JSX.Element {
  const sidebar = useSidebarCollapse(tab === PANEL_TAB.PLANS);
  return createElement(DesktopShell, {
    gates: { accountRequired: false, onBeginSignIn: ignore, signInFace: { play: 0 } },
    identity: {
      speakers: { listening: false, lukeSpeaking: false },
      voiceActive: { developer: false, luke: false },
      fixtureSpeaking: false,
      voiceOpening: false,
    },
    tab,
    onTabChange: ignore,
    plans: plansControl(),
    sidebar,
    settings: settingsPanelProps(),
    settingsSearchOpen: false,
    onSettingsSearchToggle: ignore,
  });
}

let root: Root | undefined;

function show(tab: PanelTab): void {
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement("div")));
    root.render(createElement(Window, { tab }));
  });
}

/** Closes the window, as a quit does, so the next `show` is a fresh launch. */
function quit(): void {
  act(() => root?.unmount());
  root = undefined;
}

function sidebar(): HTMLElement {
  const aside = document.body.querySelector<HTMLElement>("aside.desktop-sidebar");
  assert.ok(aside, "the plans' sidebar is drawn");
  return aside;
}

function toggle(): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>("button[aria-keyshortcuts='Meta+B']");
}

function press(): void {
  const button = toggle();
  assert.ok(button, "the sidebar toggle is drawn");
  act(() => button.click());
}

/** Command-B from anywhere in the window, answering whether the window claimed it. */
function chord(): boolean {
  const event = new KeyboardEvent("keydown", { key: "b", metaKey: true, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

beforeEach(() => {
  window.localStorage.clear();
  // Luke's face asks whether motion is reduced, which jsdom has no answer to.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: ignore, removeEventListener: ignore }),
  });
});

afterEach(() => {
  quit();
  document.body.innerHTML = "";
});

test("the toggle folds the sidebar away and brings it back, and the fold outlives a relaunch", () => {
  show(PANEL_TAB.PLANS);
  assert.equal(sidebar().hasAttribute("inert"), false);
  assert.equal(toggle()?.getAttribute("aria-label"), "Hide sidebar");

  press();
  assert.equal(sidebar().hasAttribute("inert"), true);
  assert.equal(toggle()?.getAttribute("aria-label"), "Show sidebar");

  quit();
  show(PANEL_TAB.PLANS);
  assert.equal(sidebar().hasAttribute("inert"), true, "a relaunch keeps the sidebar folded");

  press();
  assert.equal(sidebar().hasAttribute("inert"), false);
  assert.equal(toggle()?.getAttribute("aria-label"), "Hide sidebar");
});

test("Command-B folds and unfolds the sidebar on Plans", () => {
  show(PANEL_TAB.PLANS);
  assert.equal(chord(), true);
  assert.equal(sidebar().hasAttribute("inert"), true);
  assert.equal(chord(), true);
  assert.equal(sidebar().hasAttribute("inert"), false);
});

test("Settings keeps its page list whatever the fold, and hands the plans back as it found them", () => {
  show(PANEL_TAB.PLANS);
  press();

  show(PANEL_TAB.SETTINGS);
  const pages = document.body.querySelector<HTMLElement>("nav[aria-label='Settings pages']");
  assert.ok(pages, "the settings page list is drawn");
  assert.equal(pages.closest("[inert]"), null);
  assert.equal(toggle(), null, "Settings offers no toggle");
  assert.equal(chord(), false, "Command-B is left alone in Settings");

  show(PANEL_TAB.PLANS);
  assert.equal(sidebar().hasAttribute("inert"), true, "the plans come back still folded");
});
