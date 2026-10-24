// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * chapter-rail-width.test.ts -- the chapter rail stands beside its chapter or floats over it at every width of the side panel, a fractional one among them.
 *
 * The rail's two rules meet at 640px: the panel floats the rail from its
 * strip below it, and hides a rail left closed from there up. Written as
 * `max-width: 639px` and `min-width: 640px`, a panel 639.5px wide matched
 * neither, so it drew the toggle for a rail beside a chapter that had no room for it. jsdom answers no container query, so the sheet is
 * laid for the width given (`testing/container-width.ts`). Synthetic throughout.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.innerHTML = "";
});

/** What a closed rail and the two toggles that open it draw in a panel as wide as given. */
function railAt(width: number) {
  laid?.remove();
  laid = layContainersAt({ "side-panel": width }, { only: ["./tasks.css"] });
  document.body.innerHTML = [
    '<div class="chapters-view" data-rail-beside="false">',
    '<div class="chapter-rail"></div>',
    '<button class="chapter-rail-toggle" data-place="beside"></button>',
    '<button class="chapter-rail-toggle" data-place="over"></button>',
    "</div>",
  ].join("");
  const drawn = (selector: string) =>
    getComputedStyle(document.querySelector(selector) ?? assert.fail(`${selector} stands`))
      .display !== "none";
  return {
    rail: drawn(".chapter-rail"),
    toggleBeside: drawn('[data-place="beside"]'),
    toggleOver: drawn('[data-place="over"]'),
  };
}

test("a panel under 640px floats the rail, whole or fractional: the toggle that opens it over the chapter is drawn", () => {
  for (const width of [639, 639.5, 639.99]) {
    assert.deepEqual(
      railAt(width),
      { rail: true, toggleBeside: false, toggleOver: true },
      `${width}px`,
    );
  }
});

test("a panel 640px or wider hides a closed rail and draws the toggle that opens it beside the chapter", () => {
  for (const width of [640, 640.5, 800]) {
    assert.deepEqual(
      railAt(width),
      { rail: false, toggleBeside: true, toggleOver: false },
      `${width}px`,
    );
  }
});
