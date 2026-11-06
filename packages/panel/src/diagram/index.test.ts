// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DIAGRAM_APPEARANCE, DIAGRAM_DRAWING } from "@repo/ui/diagram-contract";
import { afterEach, beforeEach, test } from "vitest";
import { diagram } from "./index.js";

const BOX = { x: 0, y: 0, width: 80, height: 20 };

beforeEach(() => {
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

test("a diagram is laid out inside the screen recording's block, never loose in the page", async () => {
  const added: Element[] = [];
  const watch = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target !== document.body) continue;
      for (const node of record.addedNodes) if (node instanceof Element) added.push(node);
    }
  });
  watch.observe(document.body, { childList: true });
  const drawing = await diagram.draw(
    "flowchart LR\n  Alice --> Bob\n  classDef payroll fill:#f00\n  class Alice payroll",
    DIAGRAM_APPEARANCE.LIGHT,
  );
  watch.disconnect();
  assert.equal(drawing.kind, DIAGRAM_DRAWING.DRAWN);
  assert.ok(added.length > 0);
  for (const element of added) assert.ok(element.classList.contains("ph-no-capture"), element.id);
});
