// @vitest-environment jsdom
import assert from "node:assert/strict";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { landedBundles, onSideBundles } from "#testing/side-bundles";
import { TaskBoard } from "./task-board";

test("the whiteboard is drawn under a root the screen recording leaves out", async () => {
  // The bundle already landed, as it is once a board has been shown in this window.
  const bundles = await Effect.runPromise(
    landedBundles({
      whiteboard: () =>
        Promise.resolve({
          mount: () => ({
            show: () => undefined,
            scene: () => undefined,
            unmount: () => undefined,
          }),
          render: () => Promise.resolve(undefined),
        }),
    }),
  );

  const markup = renderToStaticMarkup(
    onSideBundles(
      bundles,
      createElement(TaskBoard, {
        taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
        board: { elements: [], appliedDrawing: 0 },
      }),
    ),
  );

  assert.match(markup, /^<section class="task-board ph-no-capture" aria-label="Whiteboard">/u);
  assert.match(markup, /class="task-board-canvas"/u);
});
