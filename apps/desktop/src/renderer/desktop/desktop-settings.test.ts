// @vitest-environment jsdom

import assert from "node:assert/strict";
import { SETTINGS_RESET_SCOPE } from "@sidecar/settings";
import { settingsView } from "@sidecar/settings/testing";
import type { AppSettingsView } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "#shared/messages/acts";
import { navigationHistory } from "#testing/navigation-history";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { useAppKeymap } from "../app-commands";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE, SETTINGS_SEARCH_ROW } from "../settings-anchors";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { DesktopSettings } from "./desktop-settings";
import { SIDEBAR_WIDTH } from "./sidebar-collapse";

const ignore = () => undefined;

/**
 * Turns the page from outside Settings, the way the app's Escape or a spoken
 * request does. Set by the mounted harness.
 */
let turnPage: (view: SettingsView) => void = ignore;

/** Settings with the page held the way the app holds it, so a press turns it. */
function Harness({ settings }: { settings?: AppSettingsView }): React.JSX.Element {
  const [view, setView] = useState<SettingsView>(SETTINGS_VIEW.ROOT);
  turnPage = setView;
  return createElement(DesktopSettings, {
    sidebar: {
      collapsed: false,
      width: SIDEBAR_WIDTH.DEFAULT,
      onToggle: ignore,
      onResize: ignore,
    },
    history: navigationHistory(),
    settings: settingsPanelProps({
      view,
      onViewChange: setView,
      ...(settings ? { settings } : undefined),
    }),
    onSearchEngaged: ignore,
    onExit: ignore,
  });
}

/** Every root a test mounted, unmounted after it so nothing it started outlives it. */
const mounted: Root[] = [];

function mount(settings?: AppSettingsView): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() => {
    root.render(createElement(Harness, settings ? { settings } : {}));
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

function press(input: HTMLInputElement, key: string, isComposing = false): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing, bubbles: true }));
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

/** The toolbar's button with these words, if it draws one. */
function toolbarButton(container: ParentNode, words: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>(".desktop-toolbar button")].find(
    (button) => button.textContent === words,
  );
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
  act(() => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

test("typing in the sidebar search turns the page list into results grouped under their pages", () => {
  const container = mount();
  const pages = pageList(container);
  assert.deepEqual(pages, ["General", "Voice", "Appearance", "Keyboard shortcuts"]);

  type(field(container), "hotkey");
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

  // A page turned some other way leaves the result unmarked.
  act(() => turnPage(SETTINGS_VIEW.ROOT));
  assert.equal(result(container, "Stop Luke").getAttribute("aria-current"), null);

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
  // An Escape spent dismissing an input method's candidates leaves the query.
  press(input, "Escape", true);
  assert.equal(input.value, "voice");
  press(input, "Escape");
  assert.equal(input.value, "");
  assert.equal(pageList(container).length, 4);
  assert.equal(document.activeElement, input, "the first Escape only clears");

  press(input, "Escape");
  assert.notEqual(document.activeElement, input, "the second Escape lets go of the caret");
  assert.deepEqual(unwound, []);
  window.removeEventListener("keydown", onWindowKey);
});

test("the search's clear button hangs no pill, its glyph being the one every search field draws", () => {
  const container = mount();
  type(field(container), "voice");
  const clear = sidebar(container).querySelector<HTMLButtonElement>(
    "button[aria-label='Clear search']",
  );
  assert.ok(clear, "a standing query draws the clear button");
  act(() => {
    clear.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.equal(document.body.querySelector('[role="tooltip"]')?.textContent, undefined);
});

test("Command-F puts the caret in the search, whose empty field prints the chord until the caret arrives", () => {
  function Keyed() {
    useAppKeymap(true);
    return createElement(Harness);
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Keyed));
  });
  const input = field(container);
  const hint = () => sidebar(container).querySelector(".settings-search-shortcut");
  assert.equal(input.getAttribute("aria-keyshortcuts"), "Meta+F");
  assert.equal(hint()?.textContent, "⌘F");

  const event = new KeyboardEvent("keydown", { key: "f", metaKey: true, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  assert.equal(event.defaultPrevented, true);
  assert.equal(document.activeElement, input);

  type(input, "voice");
  assert.equal(hint(), null, "a query takes the chord's place");
  act(() => root.unmount());
});

test("a page off its defaults offers Reset to defaults in the toolbar, not in the page, and says a refusal beside it", async () => {
  const sent: Act[] = [];
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      recordSurfaceEvent: ignore,
      act: (request: Act) => {
        sent.push(request);
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: { status: ACTION_RESULT_STATUS.REJECTED, reason: "The settings are busy." },
        });
      },
    },
  });
  const container = mount(settingsView({ voiceAvailable: true, showInDock: true }));
  act(() => turnPage(SETTINGS_VIEW.APPEARANCE));
  const reset = toolbarButton(container, "Reset to defaults");
  assert.ok(reset, "the toolbar offers the page's reset");
  const resets = [...container.querySelectorAll("button")].filter((button) =>
    (button.getAttribute("aria-label") ?? button.textContent ?? "").startsWith("Reset"),
  );
  assert.deepEqual(resets, [reset], "the page itself carries no reset of its own");

  await act(async () => reset.click());
  assert.deepEqual(sent, [
    { kind: ACT_KIND.SETTINGS_RESET, payload: { scope: SETTINGS_RESET_SCOPE.APPEARANCE } },
  ]);
  assert.equal(
    container.querySelector(".desktop-toolbar [role='alert']")?.textContent,
    "The settings are busy.",
  );
});

test("a page at its defaults offers no reset", () => {
  const container = mount(settingsView({ voiceAvailable: true }));
  act(() => turnPage(SETTINGS_VIEW.APPEARANCE));
  assert.equal(toolbarButton(container, "Reset to defaults"), undefined);
});

test("the front page draws no Quit button, which the app menu's Quit already does", () => {
  const container = mount(settingsView({ voiceAvailable: true }));
  const words = [...container.querySelectorAll("button")].map((button) => button.textContent);
  assert.ok(!words.some((text) => text?.includes("Quit")));
});
