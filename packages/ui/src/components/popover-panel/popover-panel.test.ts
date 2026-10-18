// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  POPOVER_PANEL_LOOK,
  PopoverPanel,
  type PopoverPanelHint,
  type PopoverPanelLook,
} from "./popover-panel.js";

/**
 * popover-panel.test.ts -- a hung panel is a dialog named by its title,
 * takes the focus as it opens, onto its owner's control or itself, keeps
 * Escape from the window and hands it to its owner, draws its × only where
 * named, and tells its owner when focus leaves it, never when focus moves
 * inside it.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** What a panel under test was told, and what it told back. */
interface Heard {
  dismissed: number;
  left: (EventTarget | null)[];
  keys: string[];
}

/** A panel holding a field and a button, with a button outside it to take focus. */
function Stage({
  heard,
  look,
  closeLabel,
  focusField,
  hint,
}: {
  heard: Heard;
  look?: PopoverPanelLook;
  closeLabel?: string;
  focusField?: boolean;
  hint?: PopoverPanelHint;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button" }, "Outside"),
    createElement(PopoverPanel, {
      id: "panel",
      title: "Diff settings",
      look,
      closeLabel,
      hint,
      initialFocus: focusField === true ? field : undefined,
      onDismiss: () => {
        heard.dismissed += 1;
      },
      onLeave: (left) => heard.left.push(left),
      onKeyDown: (event) => heard.keys.push(event.key),
      children: [
        createElement("input", { key: "field", ref: field, "aria-label": "Search" }),
        createElement("button", { key: "inside", type: "button" }, "Inside"),
      ],
    }),
  );
}

/** A fresh record of what a panel heard. */
function heardNothing(): Heard {
  return { dismissed: 0, left: [], keys: [] };
}

/** `stage` mounted in the document. */
function drawn(stage: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(stage));
  return container;
}

/** The dialog in `container`. */
function dialogIn(container: HTMLElement): HTMLElement {
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(dialog, "the panel is a dialog");
  return dialog;
}

/** The name a reader hears for `dialog`, read through what labels it. */
function nameOf(dialog: HTMLElement): string | null | undefined {
  const by = dialog.getAttribute("aria-labelledby");
  return by === null ? dialog.getAttribute("aria-label") : document.getElementById(by)?.textContent;
}

/** The button in `container` named `name`. */
function button(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
}

/** Presses `key` on what holds focus, answering whether the window heard it. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  let windowHeard = false;
  const listen = () => {
    windowHeard = true;
  };
  window.addEventListener("keydown", listen);
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });
  window.removeEventListener("keydown", listen);
  return windowHeard;
}

test("a card is a dialog named by the title at its head", () => {
  const container = drawn(createElement(Stage, { heard: heardNothing() }));
  const dialog = dialogIn(container);
  assert.equal(nameOf(dialog), "Diff settings");
  assert.equal(dialog.querySelector("h2")?.textContent, "Diff settings");
});

test("a menu is named by its title too", () => {
  const container = drawn(
    createElement(Stage, { heard: heardNothing(), look: POPOVER_PANEL_LOOK.MENU }),
  );
  assert.equal(nameOf(dialogIn(container)), "Diff settings");
});

test("the panel takes the focus as it opens", () => {
  const container = drawn(createElement(Stage, { heard: heardNothing() }));
  assert.equal(document.activeElement, dialogIn(container));
});

test("the control its owner names takes the focus in its place", () => {
  const container = drawn(createElement(Stage, { heard: heardNothing(), focusField: true }));
  assert.equal(document.activeElement, container.querySelector("input"));
});

test("Escape is handed to the owner and goes no further than the panel", () => {
  const heard = heardNothing();
  drawn(createElement(Stage, { heard, focusField: true }));
  const windowHeard = press("Escape");
  assert.equal(heard.dismissed, 1);
  assert.equal(windowHeard, false, "the window behind never hears it");
  assert.deepEqual(heard.keys, [], "the owner's own keys never see it");
});

test("Escape while an input method composes puts nothing away", () => {
  const heard = heardNothing();
  drawn(createElement(Stage, { heard, focusField: true }));
  press("Escape", { isComposing: true });
  assert.equal(heard.dismissed, 0);
});

test("any other key reaches the owner's own keys", () => {
  const heard = heardNothing();
  drawn(createElement(Stage, { heard, focusField: true }));
  press("Enter", { metaKey: true });
  assert.deepEqual(heard.keys, ["Enter"]);
  assert.equal(heard.dismissed, 0);
});

test("the × stands only where it is named, and pressing it puts the panel away", () => {
  const bare = drawn(createElement(Stage, { heard: heardNothing() }));
  assert.equal(button(bare, "Close"), undefined);

  const heard = heardNothing();
  const closable = drawn(createElement(Stage, { heard, closeLabel: "Close" }));
  act(() => button(closable, "Close")?.click());
  assert.equal(heard.dismissed, 1);
});

test("the app's hint is hung over the × with its name", () => {
  const container = drawn(
    createElement(Stage, {
      heard: heardNothing(),
      closeLabel: "Close",
      hint: ({ label, children }) => createElement("span", { title: `${label} (hint)` }, children),
    }),
  );
  const close = button(container, "Close");
  assert.ok(close, "the × is still drawn under its hint");
  assert.equal(close.parentElement?.getAttribute("title"), "Close (hint)");
});

test("focus leaving the panel is told to the owner with where it went", () => {
  const heard = heardNothing();
  const container = drawn(createElement(Stage, { heard }));
  const outside = button(container, "Outside");
  act(() => outside?.focus());
  assert.deepEqual(heard.left, [outside]);
});

test("focus moving inside the panel is not a leaving", () => {
  const heard = heardNothing();
  const container = drawn(createElement(Stage, { heard, focusField: true }));
  act(() => button(container, "Inside")?.focus());
  assert.deepEqual(heard.left, []);
});
