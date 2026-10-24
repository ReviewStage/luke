// schema-rows.test.ts -- a schema row's control, its write, and its refusal, as a reader meets them.
// @vitest-environment jsdom

import assert from "node:assert/strict";
import { SETTINGS_ACT_KIND } from "@luke/host/contract";
import {
  type AppSettingField,
  SETTING_SECTION,
  SETTINGS_PAGE,
  type SettingSection,
} from "@luke/settings";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { rendererRegistry } from "../renderer-runtime.js";
import { fakeActPort, refusedOnPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { SchemaSettingRows } from "./schema-rows.js";
import { type SettingsWrites, useSettingsWrites } from "./writes.js";

/**
 * schema-rows.test.ts -- a schema row as the reader meets it: a toggle is a
 * switch named by its row, a short choice a pop-up naming the stored value,
 * each writing what it is moved to, and a refused write said under the row
 * that asked, its control pressable again. A choice whose values are heard
 * opens a dialog that plays each as it is picked and keeps only what Done does.
 */

/** Where the test's shell serves the panel's static files from. */
const ASSET_BASE = "https://luke.example/app/";

const REFUSED = "The setting could not be saved. Try again.";

/** Each stored setting a row wrote, with the value it wrote. */
let written: [AppSettingField, unknown][] = [];
/** What the store answers the next write. */
let answer: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };
/** A write the store has not answered yet, for a test that reads the row while it waits. */
let held: PromiseWithResolvers<ActionResult> | undefined;
const writes: SettingsWrites = {
  setting: (field, value) => {
    written.push([field, value]);
    return held?.promise ?? Promise.resolve(answer);
  },
  reset: () => Promise.reject(new Error("a row resets nothing")),
};
const roots: Root[] = [];

beforeEach(() => {
  written = [];
  answer = { status: ACTION_RESULT_STATUS.ACCEPTED };
  held = undefined;
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** A page these tests draw: Appearance's own rows, Voice's controls, or This Mac's Startup, whose one row is a switch. */
type DrawnPage =
  | typeof SETTINGS_PAGE.APPEARANCE
  | typeof SETTINGS_PAGE.VOICE
  | typeof SETTINGS_PAGE.THIS_MAC;

/** The section of `page` these tests draw. */
const DRAWN_SECTION = {
  [SETTINGS_PAGE.APPEARANCE]: SETTING_SECTION.MAIN,
  [SETTINGS_PAGE.VOICE]: SETTING_SECTION.CONTROLS,
  [SETTINGS_PAGE.THIS_MAC]: SETTING_SECTION.STARTUP,
} as const satisfies Record<DrawnPage, SettingSection>;

/** The rows the page draws over `settings`, beside the window's toasts, drawn with `writes`. */
function rows(
  page: DrawnPage,
  settings: ReturnType<typeof settingsView>,
  rowWrites: SettingsWrites,
) {
  const view = {
    settings,
    voiceControlsDrawn: page === SETTINGS_PAGE.VOICE,
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
  };
  const section = DRAWN_SECTION[page];
  return createElement(
    Fragment,
    null,
    createElement(SchemaSettingRows, { page, section, view, writes: rowWrites }),
    onRegistry(rendererRegistry, createElement(ToastHost)),
  );
}

/** The Appearance page's own rows over the shipped defaults, or another page's drawn section with voice ready. */
function mount(page: DrawnPage = SETTINGS_PAGE.APPEARANCE): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(rows(page, settingsView({ voiceAvailable: true }), writes)));
  return container;
}

/** This Mac's Startup drawn through the window's own writes, which reach the fake act port, and a way to draw it again over the settings the store then holds. */
function mountThroughActs(): {
  page: HTMLElement;
  redraw: (settings: ReturnType<typeof settingsView>) => void;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  function Page({ settings }: { settings: ReturnType<typeof settingsView> }) {
    return rows(SETTINGS_PAGE.THIS_MAC, settings, useSettingsWrites());
  }
  const redraw = (settings: ReturnType<typeof settingsView>) =>
    act(() => root.render(createElement(Page, { settings })));
  redraw(settingsView());
  return { page: container, redraw };
}

/** The control a reader hears as `name`. */
function control(page: HTMLElement, name: string): HTMLButtonElement {
  const found = page.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  assert.ok(found, `${name} is drawn`);
  return found;
}

/** The words the control's description says, read through its `aria-describedby`. */
function describedAs(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

/** The picker's menu row naming `words`. */
function optionNamed(words: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === words,
    ) ?? assert.fail(`the menu offers ${words}`)
  );
}

async function settle(): Promise<void> {
  await act(async () => undefined);
}

test("Zoom is a pop-up naming the stored size, described by its row, and choosing another size writes it", async () => {
  const page = mount();
  const zoom = control(page, "Zoom: 100%");
  assert.equal(describedAs(zoom), "⌘+ and ⌘− step through these sizes, and ⌘0 returns to 100%.");

  // The pop-up is the picker's menu, which the settings search lands on through the chip.
  assert.equal(zoom.getAttribute("data-search-anchor"), "zoom");
  assert.equal(zoom.getAttribute("aria-haspopup"), "dialog");
  assert.equal(document.querySelector('[role="menuitemcheckbox"]'), null);

  act(() => zoom.click());
  assert.equal(document.querySelector('[role="dialog"] input'), null);
  assert.equal(optionNamed("100%").getAttribute("aria-selected"), "true");
  act(() => optionNamed("125%").click());
  await settle();

  assert.deepEqual(written, [["zoom", 125]]);
});

test("choosing the size a pop-up already names writes nothing", async () => {
  const page = mount();

  act(() => control(page, "Zoom: 100%").click());
  act(() => optionNamed("100%").click());
  await settle();

  assert.deepEqual(written, []);
});

test("a switch flips at once, before the store answers, and is never rested for the write", async () => {
  const page = mount(SETTINGS_PAGE.THIS_MAC);
  held = Promise.withResolvers<ActionResult>();

  act(() => control(page, "Open Luke at login").click());

  const login = control(page, "Open Luke at login");
  assert.equal(login.getAttribute("aria-checked"), "false");
  assert.equal(login.disabled, false);
  assert.deepEqual(written, [["openAtLogin", false]]);

  held.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  await settle();
  assert.equal(control(page, "Open Luke at login").getAttribute("aria-checked"), "false");
  assert.equal(newestToastSays(), undefined);
});

test("a switch follows the settings again once they agree with what it flipped to", async () => {
  const { page, redraw } = mountThroughActs();
  fakeActPort({
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: () =>
      Promise.resolve({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        settings: appSettingsWire(settingsView({ openAtLogin: false })),
      }),
  });

  act(() => control(page, "Open Luke at login").click());
  await settle();
  redraw(settingsView({ openAtLogin: false }));
  assert.equal(control(page, "Open Luke at login").getAttribute("aria-checked"), "false");

  // Another window turns it back on; the switch is the store's again, not a value held here.
  redraw(settingsView({ openAtLogin: true }));
  assert.equal(control(page, "Open Luke at login").getAttribute("aria-checked"), "true");
});

test("a switch the store refuses flips back and says why in a toast, and can be pressed again", async () => {
  const page = mount(SETTINGS_PAGE.THIS_MAC);
  held = Promise.withResolvers<ActionResult>();

  act(() => control(page, "Open Luke at login").click());
  assert.equal(control(page, "Open Luke at login").getAttribute("aria-checked"), "false");
  held.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSED });
  await settle();

  const login = control(page, "Open Luke at login");
  assert.equal(login.getAttribute("aria-checked"), "true");
  assert.equal(login.disabled, false);
  assert.equal(newestToastSays(), REFUSED);

  held = undefined;
  act(() => login.click());
  await settle();
  assert.equal(control(page, "Open Luke at login").getAttribute("aria-checked"), "false");
});

test("a switch whose write the host refuses outright flips back with the host's sentence and is never left disabled", async () => {
  const { page } = mountThroughActs();
  fakeActPort({
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: () => Promise.reject(refusedOnPort(REFUSED)),
  });

  act(() => control(page, "Open Luke at login").click());
  await settle();

  const login = control(page, "Open Luke at login");
  assert.equal(login.getAttribute("aria-checked"), "true");
  assert.equal(login.disabled, false);
  assert.equal(newestToastSays(), REFUSED);
});

test("a choice the store refuses says why under its own row and marks its pop-up invalid until a choice is kept", async () => {
  const page = mount();
  answer = { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSED };
  const choose = (words: string) => {
    act(() => control(page, "Zoom: 100%").click());
    act(() => optionNamed(words).click());
  };

  choose("125%");
  await settle();
  const zoom = control(page, "Zoom: 100%");
  assert.equal(zoom.getAttribute("aria-invalid"), "true");
  assert.equal(describedAs(zoom).endsWith(REFUSED), true);
  assert.equal(zoom.disabled, false);

  answer = { status: ACTION_RESULT_STATUS.ACCEPTED };
  choose("90%");
  await settle();
  assert.equal(control(page, "Zoom: 100%").getAttribute("aria-invalid"), null);
  assert.deepEqual(written, [
    ["zoom", 125],
    ["zoom", 90],
  ]);
});

/**
 * The window's audio, faked at the media element: each clip a row starts is
 * pushed onto the list by its address, and each it stops is marked so.
 */
function listenToClips() {
  const played: string[] = [];
  const paused: string[] = [];
  const heard = { played, paused };
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    heard.played.push(this.src);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    heard.paused.push(this.src);
  });
  return heard;
}

/** The voice the dialog offers by `name`, as a radio row naming it. */
function voiceRow(name: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] [role="radio"]')].find(
      (row) => row.textContent?.startsWith(name),
    ) ?? assert.fail(`the dialog offers ${name}`)
  );
}

/** The dialog's own button named `name`. */
function dialogButton(name: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (button) => button.textContent === name || button.getAttribute("aria-label") === name,
    ) ?? assert.fail(`the dialog has ${name}`)
  );
}

test("the Voice row opens every voice under its heading, plays each as it is picked or pressed again, and Done keeps the last", async () => {
  fakeAppPlatform({ assetBase: () => ASSET_BASE });
  const heard = listenToClips();
  const page = mount(SETTINGS_PAGE.VOICE);

  act(() => control(page, "Voice: Cedar").click());
  const headings = [...document.querySelectorAll('[role="dialog"] h3')].map((h) => h.textContent);
  assert.deepEqual(headings.slice(0, 3), [
    "English",
    "North American English",
    "Southern U.S. English",
  ]);
  assert.ok(headings.includes("Brazilian Portuguese"));
  assert.ok(headings.includes("Japanese"));
  assert.equal(voiceRow("Cedar").getAttribute("aria-checked"), "true");
  assert.equal(voiceRow("Willow").textContent?.includes("Feminine"), true);

  act(() => voiceRow("Willow").click());
  act(() => voiceRow("Willow").click());
  act(() => voiceRow("Shida").click());
  await settle();
  assert.deepEqual(written, []);
  assert.deepEqual(heard.played, [
    `${ASSET_BASE}voices/willow.m4a`,
    `${ASSET_BASE}voices/willow.m4a`,
    `${ASSET_BASE}voices/shida.m4a`,
  ]);

  act(() => dialogButton("Done").click());
  await settle();
  assert.deepEqual(written, [["voice", "shida"]]);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(heard.paused.at(-1), `${ASSET_BASE}voices/shida.m4a`);
});

test("Cancel keeps the voice as it stood and stops the clip, and Done on the voice already chosen writes nothing", async () => {
  fakeAppPlatform({ assetBase: () => ASSET_BASE });
  const heard = listenToClips();
  const page = mount(SETTINGS_PAGE.VOICE);

  act(() => control(page, "Voice: Cedar").click());
  act(() => voiceRow("Marin (default)").click());
  act(() => dialogButton("Cancel").click());
  await settle();
  assert.deepEqual(written, []);
  assert.deepEqual(heard.paused, [`${ASSET_BASE}voices/marin.m4a`]);

  act(() => control(page, "Voice: Cedar").click());
  assert.equal(voiceRow("Cedar").getAttribute("aria-checked"), "true");
  act(() => dialogButton("Play sample").click());
  act(() => dialogButton("Done").click());
  await settle();
  assert.deepEqual(written, []);
  assert.equal(heard.played.at(-1), `${ASSET_BASE}voices/cedar.m4a`);
});

test("the arrows walk every voice across the headings, playing each, and the picked voice is scrolled into view as the dialog opens", async () => {
  fakeAppPlatform({ assetBase: () => ASSET_BASE });
  const heard = listenToClips();
  const scrolled: string[] = [];
  // Note that jsdom draws no layout and so has no `scrollIntoView` of its own to spy on.
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value(this: Element) {
      scrolled.push(this.textContent ?? "");
    },
  });
  const page = mount(SETTINGS_PAGE.VOICE);

  act(() => control(page, "Voice: Cedar").click());
  assert.deepEqual(scrolled, ["Cedar"]);

  const arrow = (row: HTMLButtonElement, key: string) =>
    act(() => {
      row.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  arrow(voiceRow("Verse"), "ArrowDown");
  assert.equal(voiceRow("Gleam").getAttribute("aria-checked"), "true");
  assert.equal(document.activeElement, voiceRow("Gleam"));
  arrow(voiceRow("Alloy"), "ArrowUp");
  assert.equal(voiceRow("Noeul").getAttribute("aria-checked"), "true");
  await settle();
  assert.deepEqual(heard.played, [
    `${ASSET_BASE}voices/gleam.m4a`,
    `${ASSET_BASE}voices/noeul.m4a`,
  ]);
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: undefined,
  });
});
