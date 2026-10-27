// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { RetryButton } from "../../index.js";

/**
 * retry-button.test.ts -- a failure's Retry is named "Retry", or by the
 * words its caller gives it, and retries on a press.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** jsdom's stand-in observer: jsdom lays nothing out, so nothing ever reports a resize. */
class SilentResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let root: Root | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", SilentResizeObserver);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** Draws a Retry, counting its presses, and answers its button. */
function draw(label?: string) {
  let presses = 0;
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(RetryButton, {
        ...(label === undefined ? {} : { label }),
        onRetry: () => {
          presses += 1;
        },
      }),
    ),
  );
  const button = container.querySelector("button") ?? assert.fail("no button");
  return { button, presses: () => presses };
}

test("Retry is named Retry and retries on a press", () => {
  const { button, presses } = draw();

  act(() => button.click());

  assert.equal(button.textContent, "Retry");
  assert.equal(presses(), 1);
});

test("Retry is named by the words its caller gives it", () => {
  const { button } = draw("Retry agents");

  assert.equal(button.textContent, "Retry agents");
});
