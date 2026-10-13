// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { SettingsPanel } from "./settings-panel";

/**
 * The schema's rows as a reader meets them: each control is named by the
 * words drawn beside it, and the line drawn under those words, where a row has
 * one, is what describes the control.
 */

const ignore = () => undefined;
const mounted: Root[] = [];

function mount(view: SettingsView): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() => root.render(createElement(SettingsPanel, settingsPanelProps({ view }))));
  return container;
}

/** The control a row is set with: its switch, or the chip its menu drops from. */
function control(row: Element): HTMLElement {
  return (
    row.querySelector<HTMLElement>("[role='switch'], [aria-haspopup='dialog']") ??
    assert.fail(`no control on "${row.textContent}"`)
  );
}

/** Every row a schema control stands on, keyed by the name drawn on it. */
function rows(container: ParentNode): Map<string, Element> {
  const drawn = new Map<string, Element>();
  for (const row of container.querySelectorAll(".settings-row")) {
    const name = row.querySelector(".settings-copy strong")?.firstChild?.textContent;
    if (name && row.querySelector("[role='switch'], [aria-haspopup='dialog']")) {
      drawn.set(name, row);
    }
  }
  return drawn;
}

/** What describes a control, read through the ids it points at. */
function description(element: HTMLElement): string | undefined {
  const ids = element.getAttribute("aria-describedby");
  if (ids === null) return undefined;
  return ids
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

beforeEach(() => {
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

test("every schema control is named by the words drawn beside it", () => {
  for (const view of [SETTINGS_VIEW.CODING_AGENTS, SETTINGS_VIEW.VOICE, SETTINGS_VIEW.APPEARANCE]) {
    const drawn = rows(mount(view));
    assert.ok(drawn.size > 0, `${view} draws schema rows`);
    for (const [name, row] of drawn) {
      assert.ok(
        control(row).getAttribute("aria-label")?.startsWith(name),
        `"${name}" is announced as "${control(row).getAttribute("aria-label")}"`,
      );
    }
  }
});

test("a row's line under its name is drawn and describes its control, and a row with nothing to add draws none", () => {
  const voice = rows(mount(SETTINGS_VIEW.VOICE));

  const choice = voice.get("Voice") ?? assert.fail("the Voice page draws its voice");
  const consequence = choice.querySelector(".settings-copy small")?.textContent ?? "";
  assert.match(consequence, /ends the conversation in progress/);
  assert.equal(description(control(choice)), consequence);

  const microphone = voice.get("Prefer the Mac's microphone") ?? assert.fail("no microphone row");
  assert.match(description(control(microphone)) ?? "", /Bluetooth headset/);

  const quiet = voice.get("Quiet Music and Spotify") ?? assert.fail("no Quiet Music row");
  assert.equal(quiet.querySelector(".settings-copy small"), null);
  assert.equal(description(control(quiet)), undefined);
});
