// schema-rows.test.ts -- a schema row's control, its write, and its refusal, as a reader meets them.
// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type AppSettingField, SETTING_SECTION, SETTINGS_PAGE } from "@luke/settings";
import { settingsView } from "@luke/settings/testing";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * schema-rows.test.ts -- a schema row as the reader meets it: a toggle is a
 * switch named by its row, a short choice a pop-up naming the stored value,
 * each writing what it is moved to, and a refused write said under the row
 * that asked, its control pressable again. A choice whose values are heard
 * plays the chosen one beside its pop-up, and plays each as it is chosen.
 */

/** Where the test's shell serves the panel's static files from. */
const ASSET_BASE = "https://luke.example/app/";

const REFUSED = "The setting could not be saved. Try again.";

/** Each stored setting a row wrote, with the value it wrote. */
let written: [AppSettingField, unknown][] = [];
/** What the store answers the next write. */
let answer: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };
const writes: SettingsWrites = {
  setting: (field, value) => {
    written.push([field, value]);
    return Promise.resolve(answer);
  },
  reset: () => Promise.reject(new Error("a row resets nothing")),
};
const roots: Root[] = [];

beforeEach(() => {
  written = [];
  answer = { status: ACTION_RESULT_STATUS.ACCEPTED };
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The Appearance page's own rows over the shipped defaults, or the Voice page's controls with voice ready. */
function mount(
  page: typeof SETTINGS_PAGE.APPEARANCE | typeof SETTINGS_PAGE.VOICE = SETTINGS_PAGE.APPEARANCE,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const view = {
    settings: settingsView({ voiceAvailable: true }),
    voiceControlsDrawn: page === SETTINGS_PAGE.VOICE,
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
  };
  const section = page === SETTINGS_PAGE.VOICE ? SETTING_SECTION.CONTROLS : SETTING_SECTION.MAIN;
  act(() => root.render(createElement(SchemaSettingRows, { page, section, view, writes })));
  return container;
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

async function settle(): Promise<void> {
  await act(async () => undefined);
}

test("Zoom is a pop-up naming the stored size, described by its row, and choosing another size writes it", async () => {
  const page = mount();
  const zoom = control(page, "Zoom: 100%");
  assert.equal(describedAs(zoom), "⌘+ and ⌘− step through these sizes, and ⌘0 returns to 100%.");

  act(() => zoom.click());
  const larger =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent === "125%",
    ) ?? assert.fail("the menu offers 125%");
  act(() => larger.click());
  await settle();

  assert.deepEqual(written, [["zoom", 125]]);
});

test("a switch the store refuses says why under its own row, stays as it stood, and can be pressed again", async () => {
  const page = mount();
  answer = { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSED };

  act(() => control(page, "Open Luke at login").click());
  await settle();

  const login = control(page, "Open Luke at login");
  assert.equal(page.textContent?.includes(REFUSED), true);
  assert.equal(describedAs(login), REFUSED);
  assert.equal(login.getAttribute("aria-checked"), "true");
  assert.equal(login.disabled, false);
  assert.deepEqual(written, [["openAtLogin", false]]);

  answer = { status: ACTION_RESULT_STATUS.ACCEPTED };
  act(() => login.click());
  await settle();
  assert.equal(page.textContent?.includes(REFUSED), false);
});

test("a choice the store refuses says why under its own row and marks its pop-up invalid until a choice is kept", async () => {
  const page = mount();
  answer = { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSED };
  const choose = (words: string) => {
    act(() => control(page, "Zoom: 100%").click());
    const item =
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
        (each) => each.textContent === words,
      ) ?? assert.fail(`the menu offers ${words}`);
    act(() => item.click());
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

test("the Voice row plays the chosen voice's clip beside its pop-up, and a second press stops it", async () => {
  fakeAppPlatform({ assetBase: () => ASSET_BASE });
  const heard = listenToClips();
  const page = mount(SETTINGS_PAGE.VOICE);

  act(() => control(page, "Play sample").click());
  await settle();
  assert.deepEqual(heard.played, [`${ASSET_BASE}voices/cedar.m4a`]);

  act(() => control(page, "Stop sample").click());
  await settle();
  assert.deepEqual(heard.paused, [`${ASSET_BASE}voices/cedar.m4a`]);
  control(page, "Play sample");
});

test("choosing another voice writes it and plays it, cutting off the clip already playing", async () => {
  fakeAppPlatform({ assetBase: () => ASSET_BASE });
  const heard = listenToClips();
  const page = mount(SETTINGS_PAGE.VOICE);
  act(() => control(page, "Play sample").click());

  act(() => control(page, "Voice: Cedar").click());
  const marin =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent === "Marin (default)",
    ) ?? assert.fail("the menu offers Marin");
  act(() => marin.click());
  await settle();

  assert.deepEqual(written, [["voice", "marin"]]);
  assert.deepEqual(heard.played, [
    `${ASSET_BASE}voices/cedar.m4a`,
    `${ASSET_BASE}voices/marin.m4a`,
  ]);
  assert.deepEqual(heard.paused, [`${ASSET_BASE}voices/cedar.m4a`]);
});

test("a voice whose choice is refused still plays, and the row's button stops it", async () => {
  fakeAppPlatform({ assetBase: () => ASSET_BASE });
  const heard = listenToClips();
  const page = mount(SETTINGS_PAGE.VOICE);
  answer = { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSED };

  act(() => control(page, "Voice: Cedar").click());
  const marin =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent === "Marin (default)",
    ) ?? assert.fail("the menu offers Marin");
  act(() => marin.click());
  await settle();
  assert.deepEqual(heard.played, [`${ASSET_BASE}voices/marin.m4a`]);
  control(page, "Voice: Cedar");

  act(() => control(page, "Stop sample").click());
  await settle();
  assert.deepEqual(heard.paused, [`${ASSET_BASE}voices/marin.m4a`]);
  control(page, "Play sample");
});
