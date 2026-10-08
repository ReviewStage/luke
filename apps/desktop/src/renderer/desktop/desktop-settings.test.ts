// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { settingsView } from "@sidecar/settings/testing";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { UPDATE_STATUS } from "#shared/messages/update";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE, SETTINGS_SEARCH_ROW } from "../settings-anchors";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { DesktopSettings } from "./desktop-settings";

const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED } as const);
const ignore = () => undefined;

function panelProps(
  view: SettingsView,
  onViewChange: (view: SettingsView) => void,
): SettingsPanelProps {
  return {
    account: { status: ACCOUNT_STATUS.SIGNED_OUT },
    onSignOut: () => Promise.resolve(),
    onDeleteAccount: accepted,
    view,
    onViewChange,
    microphone: {
      status: MICROPHONE_STATUS.GRANTED,
      voiceAvailable: true,
      onRequest: ignore,
      onOpenSettings: ignore,
    },
    updates: {
      update: {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "0.0.0",
        installSupported: false,
        upToDate: false,
      },
      onCheck: () => Promise.resolve(),
      onInstall: ignore,
      onOpenLatest: ignore,
    },
    settings: settingsView({ voiceAvailable: true }),
    feedback: {
      begin: ignore,
      changeMessage: ignore,
      changeName: ignore,
      changeEmail: ignore,
      attach: ignore,
      removeImage: ignore,
      dismiss: ignore,
      cancel: ignore,
      commit: ignore,
    },
    panelOpen: true,
    onQuit: ignore,
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
}

/** Settings with the page held the way the app holds it, so a press turns it. */
function Harness(): React.JSX.Element {
  const [view, setView] = useState<SettingsView>(SETTINGS_VIEW.ROOT);
  return createElement(DesktopSettings, {
    settings: panelProps(view, setView),
    onSearchEngaged: ignore,
    onBack: ignore,
  });
}

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Harness));
  });
  return container;
}

function sidebar(container: ParentNode): HTMLElement {
  const nav = container.querySelector<HTMLElement>("nav[aria-label='Settings pages']");
  assert.ok(nav, "the sidebar is drawn");
  return nav;
}

function field(container: ParentNode): HTMLInputElement {
  const input = sidebar(container).querySelector<HTMLInputElement>(
    "input[aria-label='Search settings']",
  );
  assert.ok(input, "the sidebar draws the search field");
  return input;
}

/** Types into the field the way a keystroke does, so React hears a change. */
function type(input: HTMLInputElement, text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  assert.ok(setValue);
  act(() => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(input: HTMLInputElement, key: string): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** The sidebar's list of pages by name, empty while results stand in its place. */
function pageList(container: ParentNode): readonly string[] {
  return [...sidebar(container).querySelectorAll(":scope ul > li > button")]
    .filter((button) => button.closest("section") === null)
    .map((button) => button.textContent ?? "");
}

/** The results drawn in the sidebar, as each group's heading and its rows. */
function results(container: ParentNode): readonly { page: string; rows: readonly string[] }[] {
  return [...sidebar(container).querySelectorAll("section")].map((group) => ({
    page: group.querySelector("h2")?.textContent ?? "",
    rows: [...group.querySelectorAll("button")].map((button) => button.textContent ?? ""),
  }));
}

function shownPage(container: ParentNode): string {
  return container.querySelector(".desktop-toolbar-title")?.textContent ?? "";
}

function result(container: ParentNode, label: string): HTMLButtonElement {
  const button = [...sidebar(container).querySelectorAll<HTMLButtonElement>("section button")].find(
    (candidate) => candidate.textContent === label,
  );
  assert.ok(button, `the results offer ${label}`);
  return button;
}

beforeEach(() => {
  // The page list and the field count their presses through the bridge,
  // which a test has none of.
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { recordSurfaceEvent: ignore, act: () => Promise.resolve({ ok: true }) },
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("typing in the sidebar search turns the page list into results grouped under their pages", () => {
  const container = mount();
  const pages = pageList(container);
  assert.deepEqual(pages, ["General", "Voice", "Appearance", "Keyboard shortcuts"]);

  type(field(container), "shortcut");
  assert.deepEqual(pageList(container), []);
  assert.deepEqual(results(container), [
    { page: "Keyboard shortcuts", rows: ["Talk to Luke", "Stop Luke"] },
  ]);

  // A query landing on more than one page groups its rows under each, in the
  // list's own order.
  type(field(container), "microphone");
  assert.deepEqual(
    results(container).map((group) => group.page),
    ["Voice", "Keyboard shortcuts"],
  );

  type(field(container), "zzzz");
  assert.deepEqual(results(container), []);
  assert.match(sidebar(container).textContent ?? "", /No results/);

  // The main content draws no search of its own.
  const main = container.querySelector(".settings-page");
  assert.ok(main);
  assert.equal(main.querySelector("input"), null);
  assert.equal(shownPage(container), "General");
});

test("pressing a result opens its page beside the results, which stay standing", () => {
  const container = mount();
  type(field(container), "stop luke");
  act(() => result(container, "Stop Luke").click());

  assert.equal(shownPage(container), "Keyboard shortcuts");
  const row = container.querySelector(
    `.settings-page [${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${SETTINGS_SEARCH_ROW.STOP_KEY}"]`,
  );
  assert.ok(row, "the page holding the row is drawn");
  assert.equal(field(container).value, "stop luke");
  assert.equal(result(container, "Stop Luke").getAttribute("aria-current"), "location");

  // Return opens the first result, so a sure query needs no pointer.
  type(field(container), "dock");
  const [first] = results(container);
  assert.ok(first);
  press(field(container), "Enter");
  assert.equal(shownPage(container), first.page);
});

test("clearing the query restores the page list, and Escape clears before it lets go", () => {
  const container = mount();
  const input = field(container);
  // Escape the field claims never reaches the window, whose own Escape turns
  // the page and the tab.
  const unwound: string[] = [];
  const onWindowKey = (event: KeyboardEvent) => unwound.push(event.key);
  window.addEventListener("keydown", onWindowKey);

  type(input, "voice");
  const clear = sidebar(container).querySelector<HTMLButtonElement>(
    "button[aria-label='Clear search']",
  );
  assert.ok(clear, "a standing query draws the clear button");
  act(() => clear.click());
  assert.equal(input.value, "");
  assert.equal(document.activeElement, input, "the cleared field keeps the caret");
  assert.equal(pageList(container).length, 4);

  type(input, "voice");
  press(input, "Escape");
  assert.equal(input.value, "");
  assert.equal(pageList(container).length, 4);
  assert.equal(document.activeElement, input, "the first Escape only clears");

  press(input, "Escape");
  assert.notEqual(document.activeElement, input, "the second Escape lets go of the caret");
  assert.deepEqual(unwound, []);
  window.removeEventListener("keydown", onWindowKey);
});
