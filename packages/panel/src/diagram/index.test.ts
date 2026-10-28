// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DIAGRAM_APPEARANCE, DIAGRAM_DRAWING } from "@luke/ui/diagram-contract";
import { afterEach, beforeEach, test } from "vitest";
import { diagram } from "./index.js";

/**
 * index.test.ts -- a flowchart whose label breaks a line (`<br/>`) is drawn
 * as a picture, as one without a break is, where Mermaid writes the break in
 * its SVG as HTML's unclosed `<br>`. Mermaid draws in jsdom, which lays out
 * nothing, so each SVG element measures as one box of a fixed size.
 */

/** The box every SVG element measures as, since jsdom has no SVG layout. */
const BOX = { x: 0, y: 0, width: 80, height: 20 };

beforeEach(() => {
  // jsdom has no constructed-sheet adoption and no SVG layout; the window has both.
  Object.defineProperty(document, "adoptedStyleSheets", {
    configurable: true,
    writable: true,
    value: [],
  });
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => new DOMRect(BOX.x, BOX.y, BOX.width, BOX.height),
  });
});

afterEach(() => {
  Reflect.deleteProperty(SVGElement.prototype, "getBBox");
  document.body.innerHTML = "";
});

test("a flowchart whose label breaks a line is drawn", async () => {
  const drawing = await diagram.draw(
    'flowchart LR\n  A["one<br/>two"] --> B',
    DIAGRAM_APPEARANCE.LIGHT,
  );
  assert.equal(drawing.kind, DIAGRAM_DRAWING.DRAWN);
});
