// @vitest-environment jsdom

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { SETTINGS_ACT_KIND } from "@repo/host/contract";
import {
  type AppSettingField,
  SETTING_SECTION,
  SETTINGS_PAGE,
  type SettingSection,
} from "@repo/settings";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { rendererRegistry } from "../renderer-runtime.js";
import { fakeActPort, refusedOnPort } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { SchemaSettingRows } from "./schema-rows.js";

const REFUSED = "The setting could not be saved. Try again.";

let written: [AppSettingField, unknown][] = [];
let answer: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };
let held: PromiseWithResolvers<ActionResult> | undefined;
const roots: Root[] = [];

function standStore(): void {
  fakeActPort({
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: ({ field, value }) => {
      written.push([field, value]);
      return (held?.promise ?? Promise.resolve(answer)).then((answered) => ({
        ...answered,
        settings: appSettingsWire(settingsView()),
      }));
    },
  });
}

beforeEach(() => {
  written = [];
  answer = { status: ACTION_RESULT_STATUS.ACCEPTED };
  held = undefined;
  standStore();
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

type DrawnPage = typeof SETTINGS_PAGE.APPEARANCE | typeof SETTINGS_PAGE.THIS_MAC;

const DRAWN_SECTION = {
  [SETTINGS_PAGE.APPEARANCE]: SETTING_SECTION.MAIN,
  [SETTINGS_PAGE.THIS_MAC]: SETTING_SECTION.STARTUP,
} as const satisfies Record<DrawnPage, SettingSection>;

function rows(page: DrawnPage, settings: ReturnType<typeof settingsView>) {
  const view = {
    settings,
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
  };
  const section = DRAWN_SECTION[page];
  return createElement(
    Fragment,
    null,
    createElement(SchemaSettingRows, { page, section, view }),
    createElement(RegistryContext.Provider, { value: rendererRegistry }, createElement(ToastHost)),
  );
}

function mount(page: DrawnPage = SETTINGS_PAGE.APPEARANCE): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(rows(page, settingsView()))));
  return container;
}

function mountThroughActs(): {
  page: HTMLElement;
  redraw: (settings: ReturnType<typeof settingsView>) => void;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  function Page({ settings }: { settings: ReturnType<typeof settingsView> }) {
    return rows(SETTINGS_PAGE.THIS_MAC, settings);
  }
  const redraw = (settings: ReturnType<typeof settingsView>) =>
    act(() => root.render(withQueryClient(createElement(Page, { settings }))));
  redraw(settingsView());
  return { page: container, redraw };
}

function control(page: HTMLElement, name: string): HTMLButtonElement {
  const found = page.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  assert.ok(found, `${name} is drawn`);
  return found;
}

function describedAs(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

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

  assert.equal(zoom.getAttribute("data-search-anchor"), "zoom");
  assert.equal(zoom.getAttribute("aria-haspopup"), "dialog");
  assert.equal(document.querySelector('[role="menuitemcheckbox"]'), null);

  act(() => zoom.click());
  assert.equal(document.querySelector('[role="dialog"] input'), null);
  assert.equal(optionNamed("100%").getAttribute("aria-selected"), "true");
  act(() => optionNamed("125%").click());

  await vi.waitFor(() => assert.deepEqual(written, [["zoom", 125]]));
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

  act(() => control(page, "Open Vespin at login").click());

  await vi.waitFor(() =>
    assert.equal(control(page, "Open Vespin at login").getAttribute("aria-checked"), "false"),
  );
  assert.equal(control(page, "Open Vespin at login").disabled, false);
  assert.deepEqual(written, [["openAtLogin", false]]);

  held.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  await settle();
  await vi.waitFor(() => assert.equal(control(page, "Open Vespin at login").disabled, false));
  assert.equal(control(page, "Open Vespin at login").getAttribute("aria-checked"), "false");
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

  act(() => control(page, "Open Vespin at login").click());
  await settle();
  redraw(settingsView({ openAtLogin: false }));
  assert.equal(control(page, "Open Vespin at login").getAttribute("aria-checked"), "false");

  redraw(settingsView({ openAtLogin: true }));
  await vi.waitFor(() =>
    assert.equal(control(page, "Open Vespin at login").getAttribute("aria-checked"), "true"),
  );
});

test("a switch the store refuses flips back and says why in a toast, and can be pressed again", async () => {
  const page = mount(SETTINGS_PAGE.THIS_MAC);
  held = Promise.withResolvers<ActionResult>();

  act(() => control(page, "Open Vespin at login").click());
  await vi.waitFor(() =>
    assert.equal(control(page, "Open Vespin at login").getAttribute("aria-checked"), "false"),
  );
  held.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSED });
  await vi.waitFor(() => assert.equal(newestToastSays(), REFUSED));
  await vi.waitFor(() =>
    assert.equal(control(page, "Open Vespin at login").getAttribute("aria-checked"), "true"),
  );

  const login = control(page, "Open Vespin at login");
  assert.equal(login.disabled, false);
  assert.equal(newestToastSays(), REFUSED);

  held = undefined;
  act(() => login.click());
  await vi.waitFor(() =>
    assert.equal(control(page, "Open Vespin at login").getAttribute("aria-checked"), "false"),
  );
});

test("a switch whose write the host refuses outright flips back with the host's sentence and is never left disabled", async () => {
  const { page } = mountThroughActs();
  fakeActPort({
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: () => Promise.reject(refusedOnPort(REFUSED)),
  });

  act(() => control(page, "Open Vespin at login").click());
  await vi.waitFor(() => assert.equal(newestToastSays(), REFUSED));
  await vi.waitFor(() =>
    assert.equal(control(page, "Open Vespin at login").getAttribute("aria-checked"), "true"),
  );

  const login = control(page, "Open Vespin at login");
  assert.equal(login.disabled, false);
});

test("a choice the store refuses says why under its own row and marks its pop-up invalid until a choice is kept", async () => {
  const page = mount();
  answer = { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSED };
  const choose = (words: string) => {
    act(() => control(page, "Zoom: 100%").click());
    act(() => optionNamed(words).click());
  };

  choose("125%");
  await vi.waitFor(() =>
    assert.equal(control(page, "Zoom: 100%").getAttribute("aria-invalid"), "true"),
  );
  const zoom = control(page, "Zoom: 100%");
  assert.equal(zoom.getAttribute("aria-invalid"), "true");
  assert.equal(describedAs(zoom).endsWith(REFUSED), true);
  assert.equal(zoom.disabled, false);

  answer = { status: ACTION_RESULT_STATUS.ACCEPTED };
  choose("90%");
  await vi.waitFor(() =>
    assert.equal(control(page, "Zoom: 100%").getAttribute("aria-invalid"), null),
  );
  assert.deepEqual(written, [
    ["zoom", 125],
    ["zoom", 90],
  ]);
});
