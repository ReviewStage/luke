// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { ShortcutSection } from "./shortcuts-page";

const ignore = () => undefined;
const accepted = (): Promise<ActionResult> =>
  Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });

let root: Root | undefined;

/** The talk key the page was asked to store, in the order it was asked. */
let stored: (string | undefined)[] = [];

function mountPage(): void {
  const base = settingsPanelProps();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render(
      createElement(ShortcutSection, {
        shortcuts: {
          ...base.shortcuts,
          onVoiceHotkeyChange: (accelerator: string | undefined) => {
            stored.push(accelerator);
            return accepted();
          },
        },
        writes: { setting: accepted, reset: accepted },
        voiceAvailable: true,
      }),
    );
  });
}

function changeButton(): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Change the shortcut for Talk to Luke"], button[aria-label^="Type the new shortcut"]',
  );
  assert.ok(button, "the talk row offers to change its key");
  return button;
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

  await chord({ key: "j", code: "KeyJ", metaKey: true, altKey: true });
  assert.equal(stored.length, 1, "a chord the window leaves free is stored");
});
