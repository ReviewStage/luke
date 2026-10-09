// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { plansControl } from "#testing/plans-control";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { runAppCommand, useAppKeymap, useMenuCommands } from "./app-commands";
import { DesktopShell } from "./desktop/desktop-shell";
import { useSidebarCollapse } from "./desktop/sidebar-collapse";
import { useHistoryMouseButtons, useWindowHistory } from "./navigation-history";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { PLANS_PAGE } from "./planning/planning-model";
import { SETTINGS_VIEW, type SettingsView } from "./settings-views";

const ignore = () => undefined;

const INVITATIONS: PlanSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Invitations",
  createdAt: 1,
  updatedAt: 1,
};
const BILLING: PlanSummary = {
  id: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
  name: "Billing",
  createdAt: 2,
  updatedAt: 2,
};
const EXPORTS: PlanSummary = {
  id: "5d2e8b4a-9f1c-4a3e-b7d6-1e0f2a3b4c5d",
  name: "Exports",
  createdAt: 3,
  updatedAt: 3,
};
const EVERY_PLAN = [INVITATIONS, BILLING, EXPORTS];

/** What the window shows for a place: a Settings page's title, the new-plan page, or the open plan's name. */
const NEW_PLAN_PAGE = "new plan";

/** The menu bar's one listener, as the bridge hands it to the window. */
let menuListener: ((command: AppCommand) => void) | undefined;

/**
 * The window as `App` stands it: its tab, its settings page, and a host
 * that opens and leaves plans at once, under the window's history, its
 * keymap, the menu bar, the mouse's buttons, and its Escape past the nearer
 * layers, which runs Settings' exit.
 */
function Window({
  start,
  listed,
}: {
  start: PanelTab;
  listed: readonly PlanSummary[];
}): React.JSX.Element {
  const [tab, setTab] = useState(start);
  const [view, setView] = useState<SettingsView>(SETTINGS_VIEW.ROOT);
  const [open, setOpen] = useState<string | undefined>(undefined);
  const sidebar = useSidebarCollapse(false);
  useAppKeymap(true);
  useMenuCommands(true);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        runAppCommand(APP_COMMAND.EXIT_SETTINGS);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  // A deleted plan the host had open is closed with it.
  const shown = listed.some((plan) => plan.id === open) ? open : undefined;
  const plans = plansControl({
    page: shown === undefined ? PLANS_PAGE.NEW : PLANS_PAGE.DOCUMENT,
    plans: listed,
    activePlanId: shown,
    onSelect: setOpen,
    onLeavePlan: () => setOpen(undefined),
    onNewPlan: () => setOpen(undefined),
  });
  const onTabChange = (next: PanelTab) => {
    setTab(next);
    setView(SETTINGS_VIEW.ROOT);
  };
  const history = useWindowHistory({
    known: true,
    tab,
    onTabChange,
    settingsView: view,
    onSettingsViewChange: setView,
    plans,
  });
  useHistoryMouseButtons(history, true);
  return createElement(DesktopShell, {
    gates: { accountRequired: false, onBeginSignIn: ignore, signInFace: { play: 0 } },
    identity: {
      speakers: { listening: false, lukeSpeaking: false },
      voiceActive: { developer: false, luke: false },
      fixtureSpeaking: false,
      voiceOpening: false,
    },
    tab,
    onTabChange,
    plans,
    history,
    sidebar,
    settings: settingsPanelProps({ view, onViewChange: setView }),
    onSettingsSearchEngaged: ignore,
  });
}

let root: Root | undefined;

/** Stands the window, or stands it again over a changed plan list, keeping where it has been. */
function show(listed: readonly PlanSummary[] = EVERY_PLAN, start: PanelTab = PANEL_TAB.PLANS) {
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement("div")));
    root.render(createElement(Window, { start, listed }));
  });
}

function where(): string {
  const page = document.body.querySelector(".settings-page")?.getAttribute("aria-label");
  if (page) return page;
  if (document.body.querySelector("button[aria-label='Start plan']")) return NEW_PLAN_PAGE;
  const current = document.body.querySelector(".sidebar-plan[aria-current='page']");
  assert.ok(current, "a plan is open");
  return current.textContent ?? "";
}

function click(button: HTMLButtonElement | null | undefined): void {
  assert.ok(button, "the button is drawn");
  act(() => button.click());
}

/** Opens a plan from the sidebar, as a press on its row does. */
function openPlan(plan: PlanSummary): void {
  click(
    [...document.body.querySelectorAll<HTMLButtonElement>("button.sidebar-plan")].find(
      (row) => row.textContent === plan.name,
    ),
  );
}

/** Turns to a Settings page from its page list. */
function turnTo(title: string): void {
  click(
    [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        "nav[aria-label='Settings pages'] li > button",
      ),
    ].find((row) => row.textContent === title),
  );
}

function historyButton(label: "Back" | "Forward"): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`);
  assert.ok(button, `${label} is drawn`);
  return button;
}

/** A Command chord pressed anywhere in the window, answering whether the window claimed it. */
function command(key: string): boolean {
  const event = new KeyboardEvent("keydown", { key, metaKey: true, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

function pressEscape(target: EventTarget = document.body): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

beforeEach(() => {
  window.localStorage.clear();
  HTMLElement.prototype.setPointerCapture = () => undefined;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: ignore, removeEventListener: ignore }),
  });
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
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("back and forward walk the places visited, and a new visit clears the way forward", () => {
  show();
  openPlan(INVITATIONS);
  openPlan(BILLING);

  assert.equal(command("["), true);
  assert.equal(where(), INVITATIONS.name);
  click(historyButton("Back"));
  assert.equal(where(), NEW_PLAN_PAGE);
  assert.equal(command("]"), true);
  assert.equal(where(), INVITATIONS.name);
  click(historyButton("Forward"));
  assert.equal(where(), BILLING.name);

  command("[");
  openPlan(EXPORTS);
  assert.equal(historyButton("Forward").disabled, true, "Billing is no longer ahead");
  assert.equal(command("]"), false, "nor is its chord claimed");
  command("[");
  assert.equal(where(), INVITATIONS.name);
});

test("choosing the place the window already stands on records nothing", () => {
  show();
  openPlan(INVITATIONS);
  openPlan(INVITATIONS);
  command("[");
  assert.equal(where(), NEW_PLAN_PAGE);
});

test("Settings is one step: its pages turn in place, and back from any of them returns to where it was opened", () => {
  show();
  openPlan(INVITATIONS);
  command(",");
  turnTo("Voice");
  turnTo("Keyboard shortcuts");
  assert.equal(where(), "Keyboard shortcuts");

  command("[");
  assert.equal(where(), INVITATIONS.name);
  command("]");
  assert.equal(where(), "Keyboard shortcuts", "Settings comes back on the page last open");
  click(historyButton("Back"));
  assert.equal(where(), INVITATIONS.name);
  command("[");
  assert.equal(where(), NEW_PLAN_PAGE);
});

test("a deleted plan is passed over both ways", () => {
  show();
  openPlan(INVITATIONS);
  openPlan(BILLING);
  openPlan(INVITATIONS);
  openPlan(EXPORTS);
  // Exports is deleted while open, which leaves for the new-plan page, and Billing with it.
  show([INVITATIONS]);
  assert.equal(where(), NEW_PLAN_PAGE);

  command("[");
  assert.equal(where(), INVITATIONS.name);
  command("[");
  assert.equal(
    where(),
    NEW_PLAN_PAGE,
    "Billing between two visits of Invitations is skipped whole",
  );
  assert.equal(historyButton("Back").disabled, true);
  command("]");
  command("]");
  assert.equal(where(), NEW_PLAN_PAGE, "forward skips Exports to where the delete left");
  assert.equal(historyButton("Forward").disabled, true);
});

test("the buttons are dimmed at the ends and hidden with the folded sidebar, whose chords still answer", () => {
  show();
  assert.equal(historyButton("Back").disabled, true);
  assert.equal(historyButton("Forward").disabled, true);
  assert.equal(command("["), false, "nothing behind, so the chord is left alone");

  openPlan(INVITATIONS);
  const back = historyButton("Back");
  assert.equal(back.disabled, false);
  act(() => {
    back.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.equal(document.body.querySelector('[role="tooltip"]')?.textContent, "Back⌘[");

  command("b");
  assert.ok(historyButton("Back").closest("[inert]"), "folded away with the sidebar");
  assert.equal(command("["), true);
  assert.equal(where(), NEW_PLAN_PAGE);
});

test("Settings' page list draws the same buttons, back to where Settings was opened", () => {
  show();
  openPlan(BILLING);
  command(",");
  const list = document.body.querySelector("nav[aria-label='Settings pages']");
  const back = list?.querySelector<HTMLButtonElement>("button[aria-label='Back']");
  assert.ok(back, "the page list draws Back");
  assert.equal(back.disabled, false);
  click(back);
  assert.equal(where(), BILLING.name);
});

test("Escape clears the settings search first, then leaves Settings for where it was opened, as its Back row does", () => {
  show();
  openPlan(INVITATIONS);
  command(",");
  turnTo("Voice");
  const search = document.body.querySelector<HTMLInputElement>(
    "input[aria-label='Search settings']",
  );
  assert.ok(search);
  act(() => search.focus());
  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(search, "voice");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(search.value, "voice");

  pressEscape(search);
  assert.equal(search.value, "", "the first Escape clears the query");
  assert.equal(where(), "Voice");
  pressEscape(search);
  assert.equal(where(), "Voice", "the next lets go of the caret");

  pressEscape();
  assert.equal(where(), INVITATIONS.name);
  command("]");
  assert.equal(where(), "Voice");
  click(document.body.querySelector<HTMLButtonElement>("button.settings-pages-back"));
  assert.equal(where(), INVITATIONS.name, "the Back row leaves the same way");
});

test("with nothing behind it, leaving Settings opens the plans, which Back then returns from", () => {
  show(EVERY_PLAN, PANEL_TAB.SETTINGS);
  assert.equal(where(), "General");
  const row = document.body.querySelector("button.settings-pages-back");
  assert.equal(row?.getAttribute("aria-keyshortcuts"), "Escape");

  pressEscape();
  assert.equal(where(), NEW_PLAN_PAGE);
  command("[");
  assert.equal(where(), "General");
});

test("the mouse's back and forward buttons and the menu bar's Go move as the chords do", () => {
  show();
  openPlan(INVITATIONS);
  act(() => {
    window.dispatchEvent(new MouseEvent("mouseup", { button: 3 }));
  });
  assert.equal(where(), NEW_PLAN_PAGE);
  act(() => {
    window.dispatchEvent(new MouseEvent("mouseup", { button: 4 }));
  });
  assert.equal(where(), INVITATIONS.name);

  act(() => menuListener?.(APP_COMMAND.BACK));
  assert.equal(where(), NEW_PLAN_PAGE);
  act(() => menuListener?.(APP_COMMAND.FORWARD));
  assert.equal(where(), INVITATIONS.name);
});
