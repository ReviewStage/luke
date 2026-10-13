// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { PLAN_ACTOR } from "@sidecar/hosted/plan-wire";
import { PLANNING_READ, type PlanningView } from "@sidecar/hosted/planning-view";
import { Duration, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, type ActKind, type ActResultFor } from "#shared/messages/acts";
import { RUN_PROFILE } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { captionStripProps } from "#testing/captions";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { DOCUMENT_NAME, DOCUMENT_PLAN } from "#testing/document-plan";
import { navigationHistory } from "#testing/navigation-history";
import { plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { useAppKeymap, useMenuCommands } from "../app-commands";
import type { CallCardInput } from "../call/call-card";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import {
  DOCUMENT_REGION,
  PLANS_PAGE,
  type PlansPage,
  RENAME_FAILED_NOTE,
} from "../planning/planning-model";
import { HISTORY_READ } from "../planning/use-plan-history";
import { type PlansControl, usePlansTab } from "../planning/use-plans-tab";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { DesktopShell } from "./desktop-shell";
import { SIDEBAR_WIDTH, useSidebarCollapse } from "./sidebar-collapse";

const ignore = () => undefined;

/**
 * The window as `App` stands it: the shell over the collapse and the window's
 * keymap, and over plans that open on an empty plan page and turn to the
 * new-plan page when asked for it.
 */
function Window({
  tab,
  fixture,
  plans,
  call,
}: {
  tab: PanelTab;
  fixture: boolean;
  plans: Partial<PlansControl>;
  call: CallCardInput | undefined;
}): React.JSX.Element {
  const sidebar = useSidebarCollapse(fixture);
  useAppKeymap(true);
  const [page, setPage] = useState<PlansPage>(PLANS_PAGE.DOCUMENT);
  return createElement(DesktopShell, {
    gates: {
      accountRequired: false,
      onBeginSignIn: ignore,
      onCancelSignIn: ignore,
      signInFace: { play: 0 },
    },
    tab,
    onTabChange: ignore,
    plans: plansControl({ page, onNewPlan: () => setPage(PLANS_PAGE.NEW), ...plans }),
    history: navigationHistory(),
    sidebar,
    call,
    captions: captionStripProps(),
    settings: settingsPanelProps(),
  });
}

let root: Root | undefined;

function show(
  tab: PanelTab,
  fixture = false,
  plans: Partial<PlansControl> = {},
  call: CallCardInput | undefined = undefined,
): void {
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement("div")));
    root.render(createElement(Window, { tab, fixture, plans, call }));
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

/** Drags the edge from `from` through each of `through`, releasing at the last, reading whether the column is folded at each stop. */
function drag(from: number, through: number[], column = sidebar()): boolean[] {
  const target = edge(column);
  const pointer = (type: string, clientX: number) =>
    act(() => {
      target.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }));
    });
  pointer("pointerdown", from);
  const snaps = through.map((x) => {
    pointer("pointermove", x);
    return column.hasAttribute("inert");
  });
  pointer("pointerup", through.at(-1) ?? from);
  return snaps;
}

function key(name: string, column = sidebar()): void {
  act(() => edge(column).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })));
}

function titleBarNewPlan(): HTMLButtonElement | null {
  // The sidebar's own New plan is labelled by its text, so the label finds this one alone.
  return document.body.querySelector<HTMLButtonElement>("button[aria-label='New plan']");
}

function composing(): boolean {
  return document.body.querySelector("button[aria-label='Start plan']") !== null;
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

/** A call card as a window hands it to the shell, its presses inert. */
const CALL: CallCardInput = {
  card: {
    planName: "Parser cache migration",
    status: { voiceWord: "Listening", backend: { planner: undefined, notes: false } },
    microphoneMuted: false,
  },
  speakerMuted: false,
  controls: {
    onReturn: ignore,
    onToggleMicrophone: ignore,
    onToggleSpeaker: ignore,
    onEnd: ignore,
  },
};

/** The card standing in the window now, by where it is drawn, ignoring one on its way out. */
function callCards(): string[] {
  return [...document.body.querySelectorAll<HTMLElement>('.call-card[data-leaving="false"]')].map(
    (card) => card.dataset.surface ?? "",
  );
}

test("the call card stands at the sidebar's foot above the account row, floats in the corner once the sidebar is folded, and is at the foot of Settings' page list", () => {
  show(PANEL_TAB.PLANS);
  assert.deepEqual(callCards(), []);

  show(PANEL_TAB.PLANS, false, {}, CALL);
  assert.deepEqual(callCards(), ["sidebar"]);
  const foot = document.body.querySelector(".sidebar-foot");
  assert.ok(foot?.firstElementChild?.matches(".call-card"), "the card heads the foot");
  assert.ok(foot?.querySelector(".sidebar-account"), "the account row stays under it");

  press();
  assert.deepEqual(callCards(), ["floating"]);
  press();
  assert.deepEqual(callCards(), ["sidebar"]);

  show(PANEL_TAB.SETTINGS, false, {}, CALL);
  assert.deepEqual(callCards(), ["sidebar"]);
  assert.ok(document.body.querySelector(".settings-pages .call-card"));
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
  assert.deepEqual(drag(264, [314]), [false]);
  assert.equal(width(), "314");

  // Far past the greatest width the edge only holds: there is nothing to snap to.
  assert.deepEqual(drag(314, [900]), [false]);
  assert.equal(width(), String(SIDEBAR_WIDTH.MAX));
  assert.equal(sidebar().hasAttribute("inert"), false);

  // 400 wide at 400: 220 asks for 220, and 180 asks for 180, held at the bound.
  assert.deepEqual(drag(400, [220, 180]), [false, false]);
  assert.equal(width(), String(SIDEBAR_WIDTH.MIN));
  assert.equal(sidebar().hasAttribute("inert"), false);
});

test("a drag far past the least width folds the sidebar as it crosses, the release keeps it folded, and it opens again as wide as it was", () => {
  show(PANEL_TAB.PLANS);
  drag(264, [300]);

  // 300 wide at 300: 150 asks for 150, held at the bound; 100 asks for 100.
  assert.deepEqual(drag(300, [150, 100]), [false, true]);
  assert.equal(sidebar().hasAttribute("inert"), true);
  assert.equal(toggle()?.getAttribute("aria-label"), "Show sidebar");

  press();
  assert.equal(sidebar().hasAttribute("inert"), false);
  assert.equal(width(), "300");

  assert.equal(chord(), true);
  assert.equal(chord(), true);
  assert.equal(width(), "300", "Command-B opens it at the same width");
});

test("a drag that comes back unfolds the sidebar as it crosses, and resizes it from there", () => {
  show(PANEL_TAB.PLANS);
  assert.deepEqual(drag(264, [50, 250]), [true, false]);
  assert.equal(sidebar().hasAttribute("inert"), false);
  assert.equal(width(), "250");
});

test("a pointer resting on the fold's threshold does not flicker the sidebar", () => {
  show(PANEL_TAB.PLANS);
  // 264 wide at 264, so the pointer asks for its own x: the fold is past
  // 120, and lets go only once the pointer is back by more than a tremor.
  assert.deepEqual(drag(264, [119, 121, 119, 130, 143, 150]), [
    true,
    true,
    true,
    true,
    true,
    false,
  ]);
  assert.equal(width(), String(SIDEBAR_WIDTH.MIN));
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
  assert.deepEqual(drag(264, [20], pages()), [false]);
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
    gates: {
      accountRequired: false,
      onBeginSignIn: ignore,
      onCancelSignIn: ignore,
      signInFace: { play: 0 },
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
    history: navigationHistory(),
    sidebar,
    call: undefined,
    captions: captionStripProps(),
    settings: settingsPanelProps({ view, onViewChange: setView }),
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
  // The page lists the window's own chords beside the two keys, and the
  // system's own the menu bar answers.
  const rows = [...document.body.querySelectorAll(".settings-row .shortcut-name")].map(
    (row) => row.textContent,
  );
  assert.ok(rows.includes("New plan"));
  assert.ok(rows.includes("Toggle panel"));
  assert.ok(rows.includes("New tab"));
  assert.ok(rows.includes("Exit panel full screen"));
  for (const system of [
    "Hide Luke",
    "Hide others",
    "Quit Luke",
    "Minimize",
    "Toggle full screen",
  ]) {
    assert.ok(rows.includes(system), `the page lists ${system}`);
  }
});

test("Command-N leaves Settings for a new plan", () => {
  stubBridge();
  newPlans = 0;
  route(PANEL_TAB.SETTINGS);

  assert.equal(command("n"), true);
  assert.equal(settingsPage(), undefined);
  assert.equal(newPlans, 1);
});

test("a held chord's repeats stay the window's once its offer is gone, so a held ⌘W never falls through to close the window", () => {
  stubBridge();
  route(PANEL_TAB.SETTINGS);

  // Settings has no tab to close, so the press is the menu bar's, which
  // closes the window; its repeats are not.
  assert.equal(command("w"), false);
  assert.equal(command("w", { repeat: true }), true);
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
  act(() => menuListener?.(APP_COMMAND.EXIT_SETTINGS));
  assert.equal(sidebar().hasAttribute("inert"), true, "the fold is as the menu left it");
});

test("a folded sidebar leaves New plan beside its toggle, which opens the new-plan page", () => {
  show(PANEL_TAB.PLANS);
  assert.equal(titleBarNewPlan(), null, "the open sidebar holds New plan itself");

  press();
  const button = titleBarNewPlan();
  assert.ok(button, "the folded sidebar's New plan stands in the title bar");
  act(() => {
    button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.equal(document.body.querySelector('[role="tooltip"]')?.textContent, "New plan⌘N");
  assert.equal(composing(), false);
  act(() => button.click());
  assert.equal(composing(), true, "the new-plan page is open");
  assert.ok(titleBarNewPlan() === null, "the new-plan page offers no way to itself");

  press();
  assert.equal(titleBarNewPlan(), null, "unfolding hands New plan back to the sidebar");
});

test("the sidebar's New plan draws the title bar's compose glyph", () => {
  show(PANEL_TAB.PLANS);
  press();
  const row = sidebar().querySelector("button.sidebar-new-plan svg");
  const glyph = titleBarNewPlan()?.querySelector("svg");
  assert.ok(row && glyph, "both New plans draw a glyph");
  assert.equal(row.innerHTML, glyph.innerHTML);
});

test("Settings offers no title-bar New plan even over a folded sidebar, and its way out reads Back", () => {
  show(PANEL_TAB.PLANS);
  press();

  show(PANEL_TAB.SETTINGS);
  assert.equal(titleBarNewPlan(), null);
  const back = document.body.querySelector<HTMLButtonElement>("button.settings-pages-back");
  assert.ok(back, "Settings draws its way out");
  // What it reads, less the chord hint drawn beside it for the eye alone.
  const read = back.cloneNode(true);
  assert.ok(read instanceof HTMLElement);
  for (const hidden of read.querySelectorAll("[aria-hidden='true']")) hidden.remove();
  assert.equal(read.textContent, "Back");
});

test("the panel's toggle stands in the title bar on a plan's page alone, disabled while the plan is not drawn", () => {
  show(PANEL_TAB.PLANS);
  const toggle = document.body.querySelector<HTMLButtonElement>(
    ".title-bar-controls .side-panel-toggle",
  );
  assert.ok(toggle, "a plan's page draws the toggle in the title bar");
  assert.equal(toggle.disabled, true, "no plan is drawn, so there is no panel to show");
  assert.equal(chord({ altKey: true, metaKey: true, code: "KeyB" }), false, "nor its chord");

  // The folded sidebar's title-bar New plan is the shortest way to the new-plan page.
  press();
  const newPlan = titleBarNewPlan();
  assert.ok(newPlan, "the folded sidebar's New plan stands in the title bar");
  act(() => newPlan.click());
  assert.equal(composing(), true);
  assert.equal(
    document.body.querySelector(".side-panel-toggle"),
    null,
    "the new-plan page has none",
  );

  show(PANEL_TAB.SETTINGS);
  assert.equal(document.body.querySelector(".side-panel-toggle"), null, "Settings has none");
});

test("Command-T is claimed on a drawn plan's page alone: not while a version stands in its place, nor on a plan not drawn, the new-plan page, or Settings", () => {
  const plan = {
    id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    name: "Teammate invitations",
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    document: { body: "# Teammate invitations", assumptions: [] },
  };
  const drawn = { region: { kind: DOCUMENT_REGION.READY, plan } };
  show(PANEL_TAB.PLANS, false, drawn);
  assert.equal(command("t"), true, "a drawn plan's page opens a tab");

  const version = {
    line: {
      seq: 1,
      lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 1, duringCall: false },
      startedAt: 1,
      changes: 1,
    },
    current: false,
    read: { kind: HISTORY_READ.READING },
  } as const;
  show(PANEL_TAB.PLANS, false, {
    ...drawn,
    history: { ...plansControl().history, viewing: version },
  });
  assert.equal(command("t"), false, "a version drawn in the plan's place opens none");

  show(PANEL_TAB.PLANS, false, { region: { kind: DOCUMENT_REGION.READING } });
  assert.equal(command("t"), false, "a plan not yet drawn opens none");
  show(PANEL_TAB.PLANS, false, { page: PLANS_PAGE.NEW });
  assert.equal(command("t"), false, "the new-plan page opens none");
  show(PANEL_TAB.SETTINGS);
  assert.equal(command("t"), false, "Settings opens none");
});

test("a toolbar leaves the panel's toggle room only where the toggle stands", () => {
  // Whether the window's toolbar sits beneath the panel's toggle, and so stops short of it.
  const clears = (): boolean => {
    const toolbar = document.body.querySelector(".desktop-toolbar");
    assert.ok(toolbar, "the page draws its toolbar");
    return toolbar.closest("[data-panel-toggle='true']") !== null;
  };
  show(PANEL_TAB.PLANS);
  assert.ok(document.body.querySelector(".side-panel-toggle"), "a plan's page draws the toggle");
  assert.equal(clears(), true);

  show(PANEL_TAB.SETTINGS);
  assert.equal(document.body.querySelector(".side-panel-toggle"), null, "Settings has none");
  assert.equal(clears(), false, "so its toolbar ends as far in as it starts");
});

/** The open plan as main's view carries it: listed in the sidebar and drawn in the column. */
const NAMED_VIEW: PlanningView = {
  plans: [
    {
      id: DOCUMENT_PLAN.id,
      name: DOCUMENT_NAME,
      createdAt: DOCUMENT_PLAN.createdAt,
      updatedAt: DOCUMENT_PLAN.updatedAt,
      repository: null,
    },
  ],
  listStatus: PLANNING_READ.READY,
  activePlanId: DOCUMENT_PLAN.id,
  document: { status: PLANNING_READ.READY, plan: DOCUMENT_PLAN },
};

/** Well past any pause the typing is given before its words are saved. */
const PAST_PAUSE = Duration.seconds(1);

/** The service's answers, by the act they answer. */
type ActAnswers = { [Kind in ActKind]?: () => Promise<ActResultFor<Kind>> };

/** Where the window names the open plan. */
interface PlanNaming {
  readonly tab: string;
  readonly row: string;
  readonly title: string;
}

/** A rename's payload, read back as the act's own schema admits it. */
const readRename = Schema.decodeUnknownOption(Schema.Struct({ name: Schema.String }));

/**
 * The window as `App` stands it, over the plans hook itself on that plan,
 * keeping each name the service was asked to rename it to and answering
 * each rename with `answer`, by how many were asked so far; every other act
 * is refused.
 */
function NamedWindow({
  asked,
  answer,
}: {
  asked: string[];
  answer: (asks: number) => Promise<boolean>;
}) {
  const sidebar = useSidebarCollapse(false);
  useAppKeymap(true);
  const answers: ActAnswers = {
    [ACT_KIND.PLANNING_RENAME]: () => answer(asked.length),
  };
  const plans = usePlansTab({
    acts: {
      act: <Kind extends ActKind>(kind: Kind, ...args: unknown[]): Promise<ActResultFor<Kind>> => {
        const answered = answers[kind];
        if (answered === undefined) return Promise.reject(new Error("Not answered in this test."));
        const rename = Option.getOrUndefined(readRename(args[0]));
        if (rename !== undefined) asked.push(rename.name);
        return answered();
      },
      tell: ignore,
    },
    planning: NAMED_VIEW,
    run: { fixtureMode: false, profile: RUN_PROFILE.IDLE },
    signedIn: true,
    voiceAvailable: true,
    microphoneStatus: MICROPHONE_STATUS.GRANTED,
    shown: true,
    unseenAgents: [],
    inboxWaiting: [],
    inboxPlans: [],
    voice: { view: IDLE_VOICE_VIEW, listening: false, requestMicrophoneAccess: ignore },
  });
  return createElement(DesktopShell, {
    gates: {
      accountRequired: false,
      onBeginSignIn: ignore,
      onCancelSignIn: ignore,
      signInFace: { play: 0 },
    },
    tab: PANEL_TAB.PLANS,
    onTabChange: ignore,
    plans,
    history: navigationHistory(),
    sidebar,
    call: undefined,
    captions: captionStripProps(),
    settings: settingsPanelProps(),
  });
}

/** Opens the window on the named plan under `registry`, the service answering its renames with `answer`. */
function showNamed(registry: AtomRegistry, answer: (asks: number) => Promise<boolean>): string[] {
  installScrollIntoView();
  const asked: string[] = [];
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement("div")));
    root.render(onRegistry(registry, createElement(NamedWindow, { asked, answer })));
  });
  return asked;
}

/** Where the window names the open plan: its tab in the column's strip, its row in the sidebar, and the title over its text. */
function namedAs(): PlanNaming {
  const tab = document.body.querySelector('.desktop-plan-main [role="tab"]');
  const row = sidebar().querySelector(".sidebar-plan-name");
  const title = document.body.querySelector('[aria-label="Plan name"]');
  assert.ok(tab && row && title, "the plan is named on its tab, its row, and its title");
  return { tab: tab.textContent ?? "", row: row.textContent ?? "", title: title.textContent ?? "" };
}

/** Words typed into the title, as the keyboard leaves them there. */
function typeTitle(words: string): void {
  const title = document.body.querySelector<HTMLElement>('[aria-label="Plan name"]');
  assert.ok(title, "the title's words");
  act(() => {
    title.focus();
    title.textContent = words;
    title.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}

/** Lets every promise settled so far run its continuations. */
const landed = Effect.promise(() =>
  act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  }),
);

it.effect(
  "the title's words name the plan on its tab and its sidebar row as they are typed, before anything is saved, and a pause saves them with one rename",
  () =>
    Effect.gen(function* () {
      const asked = showNamed(yield* registryOnTestClock, () => Promise.resolve(true));

      typeTitle("Teammate");
      typeTitle("Teammate invites");
      assert.deepEqual(namedAs(), {
        tab: "Teammate invites",
        row: "Teammate invites",
        title: "Teammate invites",
      });
      assert.deepEqual(asked, [], "nothing is saved while the typing goes on");

      yield* TestClock.adjust(PAST_PAUSE);
      yield* landed;
      assert.deepEqual(asked, ["Teammate invites"]);
      yield* TestClock.adjust(PAST_PAUSE);
      yield* landed;
      assert.deepEqual(asked, ["Teammate invites"], "a pause saves its words once");
      assert.equal(
        namedAs().row,
        "Teammate invites",
        "the name saved stands while the view catches up",
      );
    }),
);

it.effect(
  "a rename refused at a pause puts the saved name back on the tab, the sidebar row, and the title, and says so beside the toolbar until a later pause saves",
  () =>
    Effect.gen(function* () {
      const asked = showNamed(yield* registryOnTestClock, (asks) => Promise.resolve(asks > 1));

      typeTitle("Teammate invites");
      yield* TestClock.adjust(PAST_PAUSE);
      yield* landed;

      assert.deepEqual(asked, ["Teammate invites"]);
      assert.deepEqual(namedAs(), { tab: DOCUMENT_NAME, row: DOCUMENT_NAME, title: DOCUMENT_NAME });
      const note = () => document.body.querySelector(".desktop-toolbar-note")?.textContent;
      assert.equal(note(), RENAME_FAILED_NOTE);

      typeTitle("Team invites");
      yield* TestClock.adjust(PAST_PAUSE);
      yield* landed;
      assert.deepEqual(asked, ["Teammate invites", "Team invites"]);
      assert.equal(namedAs().tab, "Team invites");
      assert.equal(note(), undefined, "the refusal no longer says anything of the name drawn");
    }),
);

it.effect(
  "a rename refused after the title was typed away and back keeps the newest words, which the next pause asks for again",
  () =>
    Effect.gen(function* () {
      let refuse: ((renamed: boolean) => void) | undefined;
      const held = new Promise<boolean>((answer) => {
        refuse = answer;
      });
      const asked = showNamed(yield* registryOnTestClock, (asks) =>
        asks === 1 ? held : Promise.resolve(true),
      );

      typeTitle("Teammate invites");
      yield* TestClock.adjust(PAST_PAUSE);
      yield* landed;
      typeTitle("Teammate invites!");
      typeTitle("Teammate invites");
      yield* Effect.promise(() => act(async () => refuse?.(false)));
      yield* landed;

      const newest = "Teammate invites";
      assert.deepEqual(namedAs(), { tab: newest, row: newest, title: newest });
      yield* TestClock.adjust(PAST_PAUSE);
      yield* landed;
      assert.deepEqual(asked, [newest, newest]);
    }),
);
