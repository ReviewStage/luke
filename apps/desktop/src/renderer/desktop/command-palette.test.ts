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

  assert.deepEqual(rows().slice(0, 7), [
    "General",
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
  assert.deepEqual(rows().slice(0, 8), [
    "General",
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
