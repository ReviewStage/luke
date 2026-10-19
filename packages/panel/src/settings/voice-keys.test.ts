// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { ShortcutControl } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { ShortcutSection } from "./voice-keys.js";

/**
 * The Voice page's Keys, as a person changes one: pressing the talk key's
 * field starts a recording, Escape keeps the key that was there, a chord
 * that cannot be a talk key or that the window already answers is refused
 * in the row's own words, and a whole chord is stored.
 */

const TALK_FIELD = "Change the shortcut for Talk to Luke";
const TALK_RECORDING = "Cancel, or type the new shortcut for Talk to Luke";

const roots: Root[] = [];

/** Draws the Keys with voice on, every chord the talk key is asked to take recorded in `asked`. */
function draw(asked: (string | undefined)[]): HTMLElement {
  const accept = (accelerator: string | undefined): Promise<ActionResult> => {
    asked.push(accelerator);
    return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  };
  const shortcuts: ShortcutControl = {
    voiceHotkey: "Alt+Space",
    voiceHotkeyHeld: true,
    voiceChosen: false,
    voiceOff: false,
    onVoiceHotkeyChange: accept,
    stopHotkey: "Control+Alt+S",
    stopChosen: false,
    stopOff: false,
    onStopHotkeyChange: accept,
    onCapture: () => undefined,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(ShortcutSection, { shortcuts, voiceAvailable: true }),
      ),
    ),
  );
  return container;
}

function field(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name,
  );
  assert.ok(found, `no field named ${name}`);
  return found;
}

/** Presses the chord on the field holding the keyboard. */
function press(target: HTMLElement, init: KeyboardEventInit): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

/** Starts recording the talk key, as a press on its field does. */
function record(container: HTMLElement): HTMLButtonElement {
  const talk = field(container, TALK_FIELD);
  act(() => {
    talk.focus();
    talk.click();
  });
  return field(container, TALK_RECORDING);
}

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

test("pressing the field records, and Escape keeps the key that was there", () => {
  const asked: (string | undefined)[] = [];
  const container = draw(asked);

  const recording = record(container);
  assert.match(container.textContent ?? "", /Press a shortcut…/u);
  assert.match(container.textContent ?? "", /Hold ⌃, ⌥, or ⌘, optionally with ⇧/u);

  press(recording, { key: "Escape", code: "Escape" });

  assert.equal(field(container, TALK_FIELD).getAttribute("aria-pressed"), "false");
  assert.doesNotMatch(container.textContent ?? "", /Press a shortcut…/u);
  assert.deepEqual(asked, []);
});

test("a chord no talk key may be is refused, and the recording stays open", () => {
  const asked: (string | undefined)[] = [];
  const container = draw(asked);

  const recording = record(container);
  press(recording, { key: "a", code: "KeyA" });

  assert.equal(field(container, TALK_RECORDING).getAttribute("aria-pressed"), "true");
  assert.match(
    container.querySelector("[aria-live]")?.textContent ?? "",
    /Hold ⌃, ⌥, or ⌘, optionally with ⇧, and press a letter or Space\./u,
  );
  assert.deepEqual(asked, []);
});

test("a refusal still standing describes the field when it is returned to", () => {
  const container = draw([]);

  const recording = record(container);
  press(recording, { key: "a", code: "KeyA" });
  press(recording, { key: "Escape", code: "Escape" });

  const talk = field(container, TALK_FIELD);
  const described = (talk.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
  assert.equal(talk.getAttribute("aria-invalid"), "true");
  assert.match(described, /and press a letter or Space\./u);
  assert.match(described, /Space/u);
});

test("a chord the window already answers is refused by name", () => {
  const asked: (string | undefined)[] = [];
  const container = draw(asked);

  const recording = record(container);
  press(recording, { key: "n", code: "KeyN", metaKey: true });

  assert.match(
    container.querySelector("[aria-live]")?.textContent ?? "",
    /is Luke's own shortcut for New task\. Choose another\./u,
  );
  assert.deepEqual(asked, []);
});

test("a whole chord is stored and the recording ends", async () => {
  const asked: (string | undefined)[] = [];
  const container = draw(asked);

  const recording = record(container);
  press(recording, { key: "Control", code: "ControlLeft", ctrlKey: true });
  press(recording, { key: "t", code: "KeyT", ctrlKey: true, altKey: true });
  await act(() => Promise.resolve());

  assert.deepEqual(asked, ["Control+Alt+T"]);
  assert.equal(field(container, TALK_FIELD).getAttribute("aria-pressed"), "false");
});
