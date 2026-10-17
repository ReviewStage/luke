// schema-rows.test.ts -- a schema row's control, its write, and its refusal, as a reader meets them.
// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type AppSettingField, SETTINGS_PAGE } from "@luke/settings";
import { settingsView } from "@luke/settings/testing";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DESKTOP_CAPABILITIES } from "#testing/app-state";
import { SchemaSettingRows } from "./schema-rows";
import type { SettingsWrites } from "./writes";

/**
 * schema-rows.test.ts -- a schema row as the reader meets it: a toggle is a
 * switch named by its row, a short choice a pop-up naming the stored value,
 * each writing what it is moved to, and a refused write said under the row
 * that asked, its control pressable again.
 */

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
});

/** The Appearance page's own rows over the shipped defaults. */
function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const view = {
    settings: settingsView(),
    voiceControlsDrawn: false,
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
  };
  act(() =>
    root.render(createElement(SchemaSettingRows, { page: SETTINGS_PAGE.APPEARANCE, view, writes })),
  );
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
