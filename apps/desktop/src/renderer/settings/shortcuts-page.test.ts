// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VOICE_HOTKEY_NONE, voiceHotkeyLabel } from "@sidecar/settings";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { sheetStyle, withKeyboardOn } from "#testing/css-rules";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE, SETTINGS_SEARCH_ROW } from "../settings-anchors";
import { settingsSearchEntries } from "../settings-search";
import { SETTINGS_VIEW } from "../settings-views";
import { settingsRowsInput } from "./settings-panel";
import { ShortcutSection, WindowShortcutSections } from "./shortcuts-page";

const ignore = () => undefined;
const accepted = (): Promise<ActionResult> =>
  Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });

let root: Root | undefined;

/** The talk key the page was asked to store, in the order it was asked. */
let stored: (string | undefined)[] = [];

/** The whole page as Settings draws it, the talk key registered at ⌥Space. */
function mountPage(): void {
  const base = settingsPanelProps({ view: SETTINGS_VIEW.SHORTCUTS });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render([
      createElement(ShortcutSection, {
        key: "keys",
        shortcuts: {
          ...base.shortcuts,
          voiceHotkey: "Alt+Space",
          onVoiceHotkeyChange: (accelerator: string | undefined) => {
            stored.push(accelerator);
            return accepted();
          },
        },
        writes: {
          setting: accepted,
          reset: () => Promise.reject(new Error("Nothing is reset in this test.")),
        },
        voiceAvailable: true,
      }),
      createElement(WindowShortcutSections, { key: "window" }),
    ]);
  });
}

/** Whether the talk key's field is recording, as it says to a reader. */
function recording(): boolean {
  return changeButton().getAttribute("aria-pressed") === "true";
}

/** The menu item with these words, in whichever menu stands open. */
function menuItem(label: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`no ${label} item`)
  );
}

function openTalkMenu(): void {
  const more = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Talk to Luke shortcut actions"]',
  );
  assert.ok(more, "the talk row offers its menu");
  act(() => more.click());
}

function changeButton(): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label$="the shortcut for Talk to Luke"], button[aria-label$="the new shortcut for Talk to Luke"]',
  );
  assert.ok(button, "the talk row offers to change its key");
  return button;
}

/** A row by the anchor a search result lands on. */
function row(anchor: string): HTMLElement {
  const found = document.body.querySelector<HTMLElement>(
    `[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${anchor}"]`,
  );
  assert.ok(found, `a row is anchored at ${anchor}`);
  return found;
}

/** The caps a row draws, one entry per key. */
function caps(element: HTMLElement): readonly string[] {
  return [...element.querySelectorAll(".keycap")].map((cap) => cap.textContent ?? "");
}

async function chord(init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    changeButton().dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

beforeEach(() => {
  stored = [];
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { act: () => Promise.resolve({ ok: true }), recordSurfaceEvent: ignore },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

test("the page stands in sections that follow the menu bar, each row a name and its chord", () => {
  mountPage();

  assert.deepEqual(
    [...document.body.querySelectorAll("section h2")].map((label) => label.textContent),
    ["Voice", "General", "Plans", "Tabs & panels", "Call", "Navigation", "Window"],
  );
  const tabs = [...document.body.querySelectorAll("section")].find(
    (section) => section.querySelector("h2")?.textContent === "Tabs & panels",
  );
  assert.ok(tabs, "the tabs and panels have a section of their own");
  assert.equal(
    tabs.querySelector(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${APP_COMMAND.NEW_TAB}"]`)
      ?.textContent,
    "New tab⌘T",
  );
});

test("Tabs & panels lists the panes' and the tabs' own shortcuts, and none that opens a side-panel tab", () => {
  mountPage();

  const tabs = [...document.body.querySelectorAll("section")].find(
    (section) => section.querySelector("h2")?.textContent === "Tabs & panels",
  );
  assert.ok(tabs, "the tabs and panels have a section of their own");
  assert.deepEqual(
    [...tabs.querySelectorAll(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}]`)].map((each) =>
      each.getAttribute(SETTINGS_SEARCH_ANCHOR_ATTRIBUTE),
    ),
    [
      APP_COMMAND.TOGGLE_SIDEBAR,
      APP_COMMAND.TOGGLE_SIDE_PANEL,
      APP_COMMAND.TOGGLE_FULL_SCREEN,
      APP_COMMAND.EXIT_FULL_SCREEN,
      APP_COMMAND.NEW_TAB,
      APP_COMMAND.CLOSE_TAB,
      APP_COMMAND.MOVE_TAB_LEFT,
      APP_COMMAND.MOVE_TAB_RIGHT,
    ],
  );
  assert.doesNotMatch(document.body.textContent ?? "", /Show (board|code|transcript|work)/u);
});

test("a chord is drawn as one cap per key, in the order a Mac writes them", () => {
  mountPage();

  assert.deepEqual(caps(row(APP_COMMAND.TOGGLE_SIDE_PANEL)), ["⌥", "⌘", "B"]);
  assert.deepEqual(caps(row(APP_COMMAND.MOVE_TAB_RIGHT)), ["⇧", "⌘", "→"]);
  assert.deepEqual(caps(row(APP_COMMAND.EXIT_FULL_SCREEN)), ["Esc"]);
  assert.deepEqual(caps(row(SETTINGS_SEARCH_ROW.TALK_KEY)), ["⌥", "Space"]);
});

test("every shortcut the settings search offers lands on a row the page draws", () => {
  mountPage();

  const entries = settingsSearchEntries(
    settingsRowsInput(settingsPanelProps({ view: SETTINGS_VIEW.SHORTCUTS })) ??
      assert.fail("the panel has settings to search"),
  ).filter((entry) => entry.page === SETTINGS_VIEW.SHORTCUTS);
  assert.ok(entries.length > 2, "the window's own shortcuts are offered beside the two keys");
  for (const entry of entries) row(entry.id);
});

test("recording the talk key says so in place, and Escape keeps the key that was there", async () => {
  mountPage();
  assert.equal(recording(), false);

  act(() => changeButton().click());
  assert.equal(recording(), true);
  assert.deepEqual(
    caps(row(SETTINGS_SEARCH_ROW.TALK_KEY)),
    [],
    "the caps give way while a chord is typed",
  );
  assert.match(row(SETTINGS_SEARCH_ROW.TALK_KEY).textContent ?? "", /Press a shortcut…/);

  await chord({ key: "Escape", code: "Escape" });
  assert.deepEqual(stored, []);
  assert.equal(recording(), false);
  assert.deepEqual(caps(row(SETTINGS_SEARCH_ROW.TALK_KEY)), ["⌥", "Space"]);
});

test("recording from the keyboard wears one ring, the recording field's, not a second around the button holding it", async () => {
  const styled = await sheetStyle();
  mountPage();
  act(() => changeButton().click());
  const field = changeButton();
  const ringed = withKeyboardOn(field, () =>
    [field, ...field.querySelectorAll("*")]
      .filter((each) => (styled(each, "outline") ?? "").includes("var(--focus-ring)"))
      .map((each) => each.className),
  );

  assert.equal(recording(), true);
  assert.deepEqual(ringed, ["shortcut-state"]);
});

test("a talk key that would take one of the window's own shortcuts is refused, and says whose it is", async () => {
  mountPage();
  act(() => changeButton().click());

  await chord({ key: "n", code: "KeyN", metaKey: true });
  assert.deepEqual(stored, []);
  assert.equal(
    document.body.querySelector('[role="alert"]')?.textContent,
    "⌘N is Luke's own shortcut for New plan. Choose another.",
  );

  assert.equal(recording(), true, "a refused chord leaves the recording open");

  await chord({ key: "j", code: "KeyJ", metaKey: true, altKey: true });
  assert.equal(stored.length, 1, "a chord the window leaves free is stored");
  assert.equal(document.body.querySelector('[role="alert"]'), null);
});

test("the talk row's ⋯ stands drawn at rest, not only under the pointer, so the row ends in it rather than in a gap", () => {
  // The sheets the row's rules stand on, which jsdom does not load on its own.
  const sheet = document.createElement("style");
  sheet.textContent = ["desktop.css", "settings.css"]
    .map((name) => readFileSync(join(import.meta.dirname, "..", "styles", name), "utf8"))
    .join("\n");
  document.head.append(sheet);
  mountPage();

  const more =
    document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Talk to Luke shortcut actions"]',
    ) ?? assert.fail("the talk row offers its menu");
  const style = getComputedStyle(more);
  assert.notEqual(style.opacity, "0");
  assert.notEqual(style.visibility, "hidden");
});

test("the talk row's ⋯ offers Change shortcut, which records in the chord's own field", () => {
  mountPage();
  openTalkMenu();

  act(() => menuItem("Change shortcut").click());
  assert.equal(recording(), true);
  assert.equal(document.activeElement, changeButton(), "the field listens for the chord");
});

test("the talk row's ⋯ removes the key, leaving none, and offers no reset to a default key", async () => {
  mountPage();
  openTalkMenu();
  const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
  assert.ok(
    !items.some((item) => item.textContent?.startsWith("Reset")),
    "nothing chosen, nothing to reset",
  );

  await act(async () => menuItem("Remove shortcut").click());
  assert.deepEqual(stored, [VOICE_HOTKEY_NONE]);
});

test("the talk key's field is described by the key it stands at, which its caps alone would not say to a reader", () => {
  mountPage();
  const described = () =>
    document.getElementById(changeButton().getAttribute("aria-describedby") ?? "")?.textContent;
  assert.equal(described(), voiceHotkeyLabel("Alt+Space"));

  act(() => changeButton().click());
  assert.equal(changeButton().getAttribute("aria-describedby"), null, "recording says itself");
});
