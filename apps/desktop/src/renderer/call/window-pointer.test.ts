// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { useStaleHoverAfterMove } from "./window-pointer";

let root: Root | undefined;
/** What main's word that the window moved reaches, as the preload hands it over. */
let moved: (() => void) | undefined;

beforeEach(() => {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onCallWindowMoved: (listener: () => void) => {
        moved = listener;
        return () => {
          moved = undefined;
        };
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

function Window(): null {
  useStaleHoverAfterMove();
  return null;
}

/** A pointer move over the page, by as much as the pointer actually travelled. */
function pointerMove(movementX: number): void {
  const event = new Event("pointermove");
  Object.defineProperties(event, { movementX: { value: movementX }, movementY: { value: 0 } });
  act(() => {
    window.dispatchEvent(event);
  });
}

test("the window moving under a still pointer makes its hover stale until the pointer itself moves", () => {
  act(() => {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    root.render(createElement(Window));
  });
  const stale = () => document.documentElement.dataset.pointerStale;
  assert.equal(stale(), undefined);
  act(() => moved?.());
  assert.equal(stale(), "true");
  // The engine's own move at the pointer's old place is not the pointer moving.
  pointerMove(0);
  assert.equal(stale(), "true");
  pointerMove(3);
  assert.equal(stale(), undefined);
});
