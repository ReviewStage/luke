// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { PlanBoard } from "./plan-board";

test("the whiteboard is drawn under a root the screen recording leaves out", () => {
  // The bundle already loaded, as it is once a board has been shown in this window.
  window.lukeWhiteboard = { mount: () => ({ show: () => undefined, unmount: () => undefined }) };

  const markup = renderToStaticMarkup(
    createElement(PlanBoard, {
      planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
      board: { elements: [], appliedDrawing: 0 },
    }),
  );

  assert.match(markup, /^<section class="plan-board ph-no-capture" aria-label="Whiteboard">/u);
  assert.match(markup, /class="plan-board-canvas"/u);
});
