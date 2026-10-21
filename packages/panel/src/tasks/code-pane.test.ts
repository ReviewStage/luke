// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { centreWithin } from "./code-pane.js";

/**
 * code-pane.test.ts -- a line centred while it stands at a placeholder
 * height, as a transcript's line off screen does until it is drawn, is
 * centred again once it is drawn at its own. jsdom lays nothing out and
 * draws no frames, so each box and each frame is the test's.
 */

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test("a line centred at its placeholder height is centred again once drawn at its own", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((heard) => frames.push(heard));
  const lines = document.body.appendChild(document.createElement("div"));
  const target = lines.appendChild(document.createElement("div"));
  let scrolled = 0;
  Object.defineProperty(lines, "scrollTop", {
    get: () => scrolled,
    set: (value: number) => {
      scrolled = value;
    },
  });
  // The log shows 600px; the line starts 1000px down it, at the placeholder's 160px until drawn.
  let height = 160;
  vi.spyOn(lines, "getBoundingClientRect").mockImplementation(() =>
    DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 600 }),
  );
  vi.spyOn(target, "getBoundingClientRect").mockImplementation(() =>
    DOMRect.fromRect({ x: 0, y: 1000 - scrolled, width: 400, height }),
  );

  centreWithin(lines, target);
  assert.equal(scrolled, 780, "centred at the height it stands at");

  height = 400;
  while (frames.length > 0) for (const heard of frames.splice(0)) heard(0);

  assert.equal(scrolled, 900, "centred again at the height it was drawn at");
});
