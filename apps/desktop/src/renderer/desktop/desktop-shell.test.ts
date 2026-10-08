// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { plansControl } from "#testing/plans-control";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { useAppKeymap, useMenuCommands } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { DesktopShell } from "./desktop-shell";
import { SIDEBAR_WIDTH, useSidebarCollapse } from "./sidebar-collapse";
import { EDGE_SNAP } from "./use-resizable-edge";

const ignore = () => undefined;

/** The window as `App` stands it: the shell over the collapse and the window's keymap. */
function Window({ tab, fixture }: { tab: PanelTab; fixture: boolean }): React.JSX.Element {
  const sidebar = useSidebarCollapse(fixture);
  useAppKeymap(true);
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
    onSettingsSearchEngaged: ignore,
  });
}

let root: Root | undefined;

function show(tab: PanelTab, fixture = false): void {
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement("div")));
    root.render(createElement(Window, { tab, fixture }));
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

/** Settings' page list, which stands where the sidebar does and shares its width. */
function pages(): HTMLElement {
  const nav = document.body.querySelector<HTMLElement>("nav[aria-label='Settings pages']");
  assert.ok(nav, "Settings' page list is drawn");
  return nav;
}

function edge(column = sidebar()): HTMLElement {
  const separator = column.querySelector<HTMLElement>("[role='separator']");
  assert.ok(separator, "the column's resize edge is drawn");
  return separator;
}

function width(column = sidebar()): string | null {
  return edge(column).getAttribute("aria-valuenow");
}

/** Drags the edge from `from` through each of `through`, releasing at the last, reading the pending snap at each stop. */
function drag(from: number, through: number[], column = sidebar()): (string | undefined)[] {
  const target = edge(column);
  const pointer = (type: string, clientX: number) =>
    act(() => {
      target.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }));
    });
  pointer("pointerdown", from);
  const snaps = through.map((x) => {
    pointer("pointermove", x);
    return column.dataset.snap;
  });
  pointer("pointerup", through.at(-1) ?? from);
  return snaps;
}

function key(name: string, column = sidebar()): void {
  act(() => edge(column).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })));
}

/** Command-B (or another B chord) from anywhere in the window, answering whether the window claimed it. */
function chord(modifiers: KeyboardEventInit = { metaKey: true }): boolean {
  const event = new KeyboardEvent("keydown", { key: "b", ...modifiers, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

beforeEach(() => {
  window.localStorage.clear();
  // jsdom captures no pointer; the drag's own events are dispatched at the edge.
  HTMLElement.prototype.setPointerCapture = () => undefined;
  // Luke's face asks whether motion is reduced, which jsdom has no answer to.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: ignore, removeEventListener: ignore }),
  });
});

afterEach(() => {
  quit();
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
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

test("Command-B folds and unfolds the sidebar on Plans, and Control-B is left to the text field", () => {
  show(PANEL_TAB.PLANS);
  assert.equal(chord({ ctrlKey: true }), false);
  assert.equal(sidebar().hasAttribute("inert"), false);
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

test("a fixture run starts open over a kept fold and keeps none of its own", () => {
  show(PANEL_TAB.PLANS);
  press();
  quit();

  // The run is known only once the first state arrives, a render in.
  show(PANEL_TAB.PLANS);
  show(PANEL_TAB.PLANS, true);
  assert.equal(sidebar().hasAttribute("inert"), false, "the developer's fold is not drawn");
  press();
  quit();

  show(PANEL_TAB.PLANS);
  assert.equal(sidebar().hasAttribute("inert"), true, "the developer's fold still stands");
});

test("a drag on the sidebar's edge sets its width, held at each bound", () => {
  show(PANEL_TAB.PLANS);
  assert.equal(width(), String(SIDEBAR_WIDTH.DEFAULT));

  // The sidebar is on the left, so the pointer moving right widens it.
  assert.deepEqual(drag(264, [314]), [EDGE_SNAP.NONE]);
  assert.equal(width(), "314");

  // Far past the greatest width the edge only holds: there is nothing to snap to.
  assert.deepEqual(drag(314, [900]), [EDGE_SNAP.NONE]);
  assert.equal(width(), String(SIDEBAR_WIDTH.MAX));
  assert.equal(sidebar().hasAttribute("inert"), false);

  // 400 wide at 400: 220 asks for 220, and 180 asks for 180, held at the bound.
  assert.deepEqual(drag(400, [220, 180]), [EDGE_SNAP.NONE, EDGE_SNAP.NONE]);
  assert.equal(width(), String(SIDEBAR_WIDTH.MIN));
  assert.equal(sidebar().hasAttribute("inert"), false);
});

test("a drag far past the least width folds the sidebar on release, and it opens again as wide as it was", () => {
  show(PANEL_TAB.PLANS);
  drag(264, [300]);

  // 300 wide at 300: 150 asks for 150, held at the bound; 100 asks for 100.
  assert.deepEqual(drag(300, [150, 100]), [EDGE_SNAP.NONE, EDGE_SNAP.COLLAPSE]);
  assert.equal(sidebar().hasAttribute("inert"), true);
  assert.equal(toggle()?.getAttribute("aria-label"), "Show sidebar");

  press();
  assert.equal(sidebar().hasAttribute("inert"), false);
  assert.equal(width(), "300");

  assert.equal(chord(), true);
  assert.equal(chord(), true);
  assert.equal(width(), "300", "Command-B opens it at the same width");
});

test("a drag that comes back inside the bounds before release does not fold the sidebar", () => {
  show(PANEL_TAB.PLANS);
  assert.deepEqual(drag(264, [50, 250]), [EDGE_SNAP.COLLAPSE, EDGE_SNAP.NONE]);
  assert.equal(sidebar().hasAttribute("inert"), false);
  assert.equal(width(), "250");
});

test("double-clicking the sidebar's edge, or Enter on it, gives back the default width", () => {
  show(PANEL_TAB.PLANS);
  drag(264, [364]);
  act(() => edge().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  assert.equal(width(), String(SIDEBAR_WIDTH.DEFAULT));

  drag(264, [214]);
  key("Enter");
  assert.equal(width(), String(SIDEBAR_WIDTH.DEFAULT));
});

test("the arrows step the sidebar's edge the way they point, within its bounds", () => {
  show(PANEL_TAB.PLANS);
  key("ArrowRight");
  assert.equal(width(), String(SIDEBAR_WIDTH.DEFAULT + 16));
  key("ArrowLeft");
  key("ArrowLeft");
  assert.equal(width(), String(SIDEBAR_WIDTH.DEFAULT - 16));

  key("Home");
  key("ArrowLeft");
  assert.equal(width(), String(SIDEBAR_WIDTH.MIN), "the keyboard never folds the sidebar");
  assert.equal(sidebar().hasAttribute("inert"), false);
  key("End");
  key("ArrowRight");
  assert.equal(width(), String(SIDEBAR_WIDTH.MAX));
});

test("the sidebar's width outlives a fold, a visit to Settings, and a relaunch", () => {
  show(PANEL_TAB.PLANS);
  drag(264, [320]);
  press();
  quit();

  show(PANEL_TAB.PLANS);
  press();
  assert.equal(width(), "320");

  show(PANEL_TAB.SETTINGS);
  show(PANEL_TAB.PLANS);
  assert.equal(width(), "320");
});

test("a kept width outside the bounds opens within them, and one that no longer reads opens at the default", () => {
  window.localStorage.setItem("luke.sidebar-width", "9000");
  show(PANEL_TAB.PLANS);
  assert.equal(width(), String(SIDEBAR_WIDTH.MAX));
  quit();

  window.localStorage.setItem("luke.sidebar-width", "wide");
  show(PANEL_TAB.PLANS);
  assert.equal(width(), String(SIDEBAR_WIDTH.DEFAULT));
});

test("a fixture run draws the default width over a kept one and keeps none of its own", () => {
  show(PANEL_TAB.PLANS);
  drag(264, [340]);
  quit();

  // The run is known only once the first state arrives, a render in.
  show(PANEL_TAB.PLANS);
  show(PANEL_TAB.PLANS, true);
  assert.equal(width(), String(SIDEBAR_WIDTH.DEFAULT), "the developer's width is not drawn");
  show(PANEL_TAB.SETTINGS, true);
  assert.equal(width(pages()), String(SIDEBAR_WIDTH.DEFAULT), "nor in Settings");
  show(PANEL_TAB.PLANS, true);
  drag(264, [220]);
  assert.equal(width(), "220");
  quit();

  show(PANEL_TAB.PLANS);
  assert.equal(width(), "340", "the developer's width still stands");
});

test("Settings' page list resizes from its own edge, one width with the plans' sidebar", () => {
  show(PANEL_TAB.SETTINGS);
  assert.equal(width(pages()), String(SIDEBAR_WIDTH.DEFAULT));
  drag(264, [330], pages());
  assert.equal(width(pages()), "330");

  show(PANEL_TAB.PLANS);
  assert.equal(width(), "330", "the plans' sidebar comes back as wide as Settings left it");
  drag(330, [290]);

  show(PANEL_TAB.SETTINGS);
  assert.equal(width(pages()), "290");
  quit();

  show(PANEL_TAB.SETTINGS);
  assert.equal(width(pages()), "290", "a width set in Settings outlives a relaunch");
});

test("a drag far past the least width in Settings holds the page list there and folds nothing", () => {
  show(PANEL_TAB.SETTINGS);
  // 264 wide at 264: 20 asks for 20, far past where the plans' sidebar would fold.
  assert.deepEqual(drag(264, [20], pages()), [undefined]);
  assert.equal(width(pages()), String(SIDEBAR_WIDTH.MIN));

  key("ArrowLeft", pages());
  assert.equal(width(pages()), String(SIDEBAR_WIDTH.MIN));

  show(PANEL_TAB.PLANS);
  assert.equal(sidebar().hasAttribute("inert"), false, "the plans' sidebar was not folded");
  assert.equal(width(), String(SIDEBAR_WIDTH.MIN));
});

test("the keys step Settings' edge, and a double-click or Enter gives back the default width", () => {
  show(PANEL_TAB.SETTINGS);
  key("ArrowRight", pages());
  assert.equal(width(pages()), String(SIDEBAR_WIDTH.DEFAULT + 16));
  key("End", pages());
  assert.equal(width(pages()), String(SIDEBAR_WIDTH.MAX));

  act(() => edge(pages()).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  assert.equal(width(pages()), String(SIDEBAR_WIDTH.DEFAULT));

  drag(264, [214], pages());
  key("Enter", pages());
  assert.equal(width(pages()), String(SIDEBAR_WIDTH.DEFAULT));
});

/** What the routed window was asked for that it does not draw itself: each new plan. */
let newPlans = 0;

/** The menu bar's one listener, as the bridge hands it to the window. */
let menuListener: ((command: AppCommand) => void) | undefined;

/**
 * The window with its tab and settings page held the way `App` holds them —
 * arriving at a tab lands on its front page — and the keymap and the menu
 * bar both wired.
 */
function Routed({ start }: { start: PanelTab }): React.JSX.Element {
  const [tab, setTab] = useState(start);
  const [view, setView] = useState<SettingsView>(SETTINGS_VIEW.ROOT);
  const sidebar = useSidebarCollapse(false);
  useAppKeymap(true);
  useMenuCommands(true);
  return createElement(DesktopShell, {
    gates: { accountRequired: false, onBeginSignIn: ignore, signInFace: { play: 0 } },
    identity: {
      speakers: { listening: false, lukeSpeaking: false },
      voiceActive: { developer: false, luke: false },
      fixtureSpeaking: false,
      voiceOpening: false,
    },
    tab,
    onTabChange: (next) => {
      setTab(next);
      setView(SETTINGS_VIEW.ROOT);
    },
    plans: plansControl({
      onNewPlan: () => {
        newPlans += 1;
      },
    }),
    sidebar,
    settings: settingsPanelProps({ view, onViewChange: setView }),
    onSettingsSearchEngaged: ignore,
  });
}

function route(start: PanelTab): void {
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement("div")));
    root.render(createElement(Routed, { start }));
  });
}

/** A Command chord pressed anywhere in the window, answering whether the window claimed it. */
function command(key: string, modifiers: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** The title of the settings page standing, or nothing while the plans are. */
function settingsPage(): string | undefined {
  return document.body.querySelector(".settings-page")?.getAttribute("aria-label") ?? undefined;
}

function stubBridge(): void {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      recordSurfaceEvent: ignore,
      act: () => Promise.resolve({ ok: true }),
      onMenuCommand: (listener: (command: AppCommand) => void) => {
        menuListener = listener;
        return () => {
          menuListener = undefined;
        };
      },
    },
  });
}

test("Command-comma opens Settings and Command-slash its Keyboard shortcuts page, from anywhere", () => {
  stubBridge();
  route(PANEL_TAB.PLANS);
  assert.equal(settingsPage(), undefined);

  assert.equal(command(","), true);
  assert.equal(settingsPage(), "General");

  assert.equal(command("/"), true);
  assert.equal(settingsPage(), "Keyboard shortcuts");
  // The page lists the window's own chords beside the two keys.
  const rows = [...document.body.querySelectorAll(".settings-row strong")].map(
    (row) => row.textContent,
  );
  assert.ok(rows.includes("New plan"));
  assert.ok(rows.includes("Toggle panel"));
  assert.ok(rows.includes("Exit full screen"));
});

test("Command-N leaves Settings for a new plan, and Command-[ backs out of Settings", () => {
  stubBridge();
  newPlans = 0;
  route(PANEL_TAB.SETTINGS);

  assert.equal(command("["), true);
  assert.equal(settingsPage(), undefined, "the plans are back");
  assert.equal(command("["), false, "nothing to back out of on the plans");

  command(",");
  assert.equal(command("n"), true);
  assert.equal(settingsPage(), undefined);
  assert.equal(newPlans, 1);
});

test("a command chosen from the menu bar runs as its chord does, and only where it can", () => {
  stubBridge();
  route(PANEL_TAB.PLANS);
  assert.ok(menuListener, "the window listens to the menu bar");

  act(() => menuListener?.(APP_COMMAND.TOGGLE_SIDEBAR));
  assert.equal(sidebar().hasAttribute("inert"), true);
  act(() => menuListener?.(APP_COMMAND.SETTINGS));
  assert.equal(settingsPage(), "General");
  // Settings draws no sidebar toggle, so the menu's item there does nothing.
  act(() => menuListener?.(APP_COMMAND.TOGGLE_SIDEBAR));
  act(() => menuListener?.(APP_COMMAND.BACK));
  assert.equal(sidebar().hasAttribute("inert"), true, "the fold is as the menu left it");
});
