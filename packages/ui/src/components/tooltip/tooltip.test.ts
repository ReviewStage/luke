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
  vi.restoreAllMocks();
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

/** The window jsdom says it is, which its root's box, read for the room a hint keeps inside, otherwise answers as none. */
function windowed(): void {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this === document.documentElement ? window.innerWidth : 0;
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return this === document.documentElement ? window.innerHeight : 0;
  });
}

/** Gives `element` a box, as layout would. */
function boxAt(element: Element, box: DOMRect): void {
  element.getBoundingClientRect = () => box;
}

/** Where the hint named `id` stands once placed, a few microtasks after it mounts: its side and its box's corner. */
async function placed(id: string): Promise<{ side: string | undefined; x: number; y: number }> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const hint = document.getElementById(id) ?? assert.fail("the hint hangs");
  const [, x = "NaN", y = "NaN"] =
    /translate\(([-\d.]+)px, ([-\d.]+)px\)/u.exec(hint.parentElement?.style.transform ?? "") ?? [];
  return { side: hint.dataset.side, x: Number(x), y: Number(y) };
}

test("a pill hangs centred below its control, and turns above it where the window ends under it", async () => {
  windowed();
  const pill = () => createElement(TooltipPill, { id: "hint", anchor, label: "Archive plan" });
  boxAt(anchor, new DOMRect(400, 100, 80, 28));
  draw(pill());
  const below = await placed("hint");
  act(() => root?.unmount());
  boxAt(anchor, new DOMRect(400, window.innerHeight - 30, 80, 28));
  draw(pill());
  const above = await placed("hint");

  assert.equal(below.side, "bottom");
  assert.equal(below.y, 100 + 28 + 6, "a gap under its control");
  assert.equal(below.x, 440, "centred on its control");
  assert.equal(above.side, "top");
});

test("a card hung beside its control stands past its end, and before its start where the window ends past it", async () => {
  windowed();
  const card = () =>
    createElement(TooltipCard, { id: "card", anchor, beside: true, children: "Archived" });
  boxAt(anchor, new DOMRect(100, 100, 120, 28));
  draw(card());
  const past = await placed("card");
  act(() => root?.unmount());
  boxAt(anchor, new DOMRect(window.innerWidth - 130, 100, 120, 28));
  draw(card());
  const before = await placed("card");

  assert.equal(past.side, "inline-end");
  assert.equal(past.x, 100 + 120 + 6);
  assert.equal(before.side, "inline-start");
  assert.ok(before.x < window.innerWidth - 130, "it stands before its control's start");
});
