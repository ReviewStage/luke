// @vitest-environment jsdom

import assert from "node:assert/strict";
import { settingsView } from "@sidecar/settings/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { runAppCommand } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { CommandPalette } from "./command-palette";

/** Where the palette sent the window: each tab and each Settings page it asked for, in order. */
interface Sent {
  tabs: PanelTab[];
  views: SettingsView[];
}

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The palette over a window on its Plans tab, opened by ⌘K's command, every page it opens recorded. */
function openPalette(): Sent {
  const sent: Sent = { tabs: [], views: [] };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(CommandPalette, {
        available: true,
        tab: PANEL_TAB.PLANS,
        onTabChange: (tab) => sent.tabs.push(tab),
        plans: plansControl(),
        settings: {
          rows: { settings: settingsView(), voiceControlsDrawn: true, accountDrawn: true },
          onViewChange: (view) => sent.views.push(view),
        },
        readFiles: () => Promise.reject(new Error("no repository is open")),
      }),
    ),
  );
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
  });
  return sent;
}

function field(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(".command-palette-search input");
  assert.ok(input, "the search field is drawn");
  return input;
}

function chooseFilter(name: string): void {
  const chip = [...document.querySelectorAll<HTMLButtonElement>(".command-palette-filter")].find(
    (each) => each.textContent === name,
  );
  assert.ok(chip, `the ${name} filter is drawn`);
  act(() => chip.click());
}

function type(words: string): void {
  const input = field();
  // Note that the value goes in through the prototype's setter, because React
  // tracks the field's own and would read a change made there as none.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Each row the palette lists, as its name and the muted words after it. */
function rows(): string[] {
  return [...document.querySelectorAll(".command-palette-row")].map((row) =>
    [row.querySelector(".command-palette-name"), row.querySelector(".command-palette-detail")]
      .map((part) => part?.textContent)
      .filter((words) => words !== undefined)
      .join(" · "),
  );
}

/** Presses the row listed as exactly these words. */
function press(listed: string): void {
  const at = rows().indexOf(listed);
  const row = document.querySelectorAll<HTMLElement>(".command-palette-row")[at];
  assert.ok(row, `${listed} is listed`);
  act(() => row.click());
}

test("the Settings filter lists every Settings page by the sidebar's names, ahead of the settings", () => {
  openPalette();
  chooseFilter("Settings");

  assert.deepEqual(rows().slice(0, 8), [
    "General",
    "Workspace",
    "Voice",
    "Appearance",
    "Keyboard shortcuts",
    "Plan template",
    "Coding agents",
    "Integrations",
  ]);
});

test("a page is found by its name, above every setting the query finds", () => {
  openPalette();
  chooseFilter("Settings");

  type("settings");

  // Note that the Settings shortcut's own row scores higher on the word than
  // any page does, and the pages still come first.
  assert.deepEqual(rows().slice(0, 9), [
    "General",
    "Workspace",
    "Voice",
    "Appearance",
    "Keyboard shortcuts",
    "Plan template",
    "Coding agents",
    "Integrations",
    "Settings · Keyboard shortcuts",
  ]);
  type("coding");
  assert.equal(rows()[0], "Coding agents");
});

test("choosing a page opens Settings on that page", () => {
  const sent = openPalette();
  chooseFilter("Settings");

  press("Integrations");

  assert.deepEqual(sent, { tabs: [PANEL_TAB.SETTINGS], views: [SETTINGS_VIEW.INTEGRATIONS] });
  assert.equal(document.querySelector(".command-palette-row"), null, "the palette closed");
});

/** The filter whose chip stands pressed. */
function chosenFilter(): string | null | undefined {
  return document.querySelector(".command-palette-filter[aria-pressed='true']")?.textContent;
}

/** Presses a key in the search field, answering whether the field kept it for itself. */
function key(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    field().dispatchEvent(event);
  });
  return !event.defaultPrevented;
}

const LEFT = { key: "ArrowLeft", code: "ArrowLeft" } as const;
const RIGHT = { key: "ArrowRight", code: "ArrowRight" } as const;
const BACK = { key: "[", code: "BracketLeft", metaKey: true } as const;
const FORWARD = { key: "]", code: "BracketRight", metaKey: true } as const;

/** The footer's hints, each its keys and then its words. */
function footer(): (string | null)[] {
  return [...document.querySelectorAll(".command-palette-footer-hint")].map(
    (hint) => hint.textContent,
  );
}

test("with the field empty, ← and → step through the filters, wrapping at the ends", () => {
  openPalette();

  assert.equal(key(RIGHT), false, "the step is the palette's, not the caret's");
  assert.equal(chosenFilter(), "Plans");
  key(RIGHT);
  assert.equal(chosenFilter(), "Agents");
  key(LEFT);
  key(LEFT);
  assert.equal(chosenFilter(), "All");
  key(LEFT);
  assert.equal(chosenFilter(), "Settings", "stepping back from All wraps to the last filter");
  key(RIGHT);
  assert.equal(chosenFilter(), "All", "stepping on from the last filter wraps to All");
});

test("once anything is typed, ← and → only move the caret, even at the text's ends", () => {
  openPalette();
  type("invite");
  const input = field();

  for (const at of [0, 3, 6]) {
    input.setSelectionRange(at, at);
    assert.equal(key(LEFT), true, `← at ${at} is the caret's`);
    assert.equal(key(RIGHT), true, `→ at ${at} is the caret's`);
  }
  assert.equal(chosenFilter(), "All");
  assert.equal(input.value, "invite");
});

test("⌘[ and ⌘] step through the filters, wrapping at the ends, whether or not anything is typed", () => {
  openPalette();

  assert.equal(key(FORWARD), false, "the window's Forward is held off");
  assert.equal(chosenFilter(), "Plans");
  type("invite");
  key(FORWARD);
  assert.equal(chosenFilter(), "Agents");
  assert.equal(key(BACK), false, "the window's Back is held off");
  key(BACK);
  key(BACK);
  assert.equal(chosenFilter(), "Settings", "stepping back from All wraps to the last filter");
  key(FORWARD);
  assert.equal(chosenFilter(), "All", "stepping on from the last filter wraps to All");
  assert.equal(field().value, "invite", "the words stay as typed");
});

test("the footer names the keys that step the filters now: ← → while the field is empty, ⌘[ ⌘] once typed", () => {
  openPalette();
  assert.deepEqual(footer(), ["↑↓Select", "⏎Open", "←→Filter"]);

  type("invite");
  assert.deepEqual(footer(), ["↑↓Select", "⏎Open", "⌘[⌘]Filter"]);

  type("");
  assert.deepEqual(footer(), ["↑↓Select", "⏎Open", "←→Filter"]);
});
