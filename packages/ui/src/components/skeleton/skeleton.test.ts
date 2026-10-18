// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { SKELETON_SHAPE, Skeleton, SkeletonRegion } from "./skeleton.js";

/**
 * skeleton.test.ts -- a placeholder region tells a reader what it is
 * reading and that it is busy, and its blocks say nothing to a reader.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a region says what it is reading, busy, and its blocks say nothing", () => {
  const page = render(
    createElement(SkeletonRegion, {
      label: "Reading your tasks",
      children: [
        createElement(Skeleton, { key: "a", width: "60%" }),
        createElement(Skeleton, { key: "b" }),
        createElement(Skeleton, { key: "c", shape: SKELETON_SHAPE.BLOCK }),
      ],
    }),
  );
  const region = page.querySelector('[role="status"]') ?? assert.fail("no status region");
  assert.equal(region.textContent, "Reading your tasks");
  assert.equal(region.getAttribute("aria-busy"), "true");
  const spoken = [...region.children].filter(
    (child) => child.getAttribute("aria-hidden") !== "true",
  );
  assert.deepEqual(
    spoken.map((child) => child.textContent),
    ["Reading your tasks"],
  );
});
