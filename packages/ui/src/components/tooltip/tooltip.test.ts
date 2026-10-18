// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { TooltipCard, TooltipPill } from "./tooltip.js";

/**
 * tooltip.test.ts -- a pill names its control and then its chord, as the
 * tooltip the control's description points at; a card's presses go no
 * further than the card, and a press on one of its buttons is a choice
 * where a press on its words is not.
 */

/** jsdom's stand-in for the browser's ResizeObserver, which it lacks: a hint is placed once and never resized here. */
class StillResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

let root: Root | undefined;
let anchor: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
  anchor = document.createElement("button");
  anchor.textContent = "Archive";
  document.body.append(anchor);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function draw(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

test("a pill says its control's name and then its chord, as the tooltip its id names", () => {
  draw(
    createElement(TooltipPill, {
      id: "hint",
      anchor,
      instant: true,
      label: "Archive plan",
      shortcut: createElement("kbd", null, "⌘E"),
    }),
  );
  const hint = document.getElementById("hint");
  assert.equal(hint?.getAttribute("role"), "tooltip");
  assert.equal(hint?.textContent, "Archive plan⌘E");
});

test("a card's presses stop at the card, and only a press on one of its buttons chooses", () => {
  const heard: string[] = [];
  draw(
    createElement(
      "div",
      { onPointerDown: () => heard.push("row"), onClick: () => heard.push("row click") },
      createElement(TooltipCard, {
        id: "hint",
        anchor,
        instant: true,
        onPress: () => heard.push("press"),
        onChoice: () => heard.push("choice"),
        children: [
          createElement("p", { key: "note" }, "Archived plans stay searchable."),
          createElement("button", { key: "open", type: "button" }, "Open archive"),
        ],
      }),
    ),
  );
  const card = document.getElementById("hint");
  const note = card?.querySelector("p");
  const open = [...(card?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Open archive",
  );
  assert.ok(note && open);
  act(() => {
    note.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    note.click();
    open.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    open.click();
  });
  assert.deepEqual(heard, ["press", "press", "choice"]);
});
