// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { IntegrationTool } from "@luke/features/integration-health";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { IntegrationToolDetail } from "./integration-tool-list.js";
import { layContainersAt } from "./testing/container-width.js";

/**
 * A tool's parameters as its page lays them at the width it stands in: one
 * under another, each its name over what it is, in a narrow page, and its
 * name in a column beside what it is from 440px. jsdom lays nothing out, so
 * the stylesheets are laid for a parameters list that wide
 * (`testing/container-width.ts`), whose query names no container. Synthetic
 * throughout.
 */

const TOOL: IntegrationTool = {
  name: "list_projects",
  description: "Lists the projects.",
  parameters: [{ name: "limit", type: "number", required: true, default: "20" }],
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** The tool's one parameter on its page, the stylesheets laid for a parameters list `width` pixels wide. */
function parameterAt(width: number): Element {
  layContainersAt({}, { unnamed: width });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(IntegrationToolDetail, { server: "Vercel", tool: TOOL, tokens: [] }),
    ),
  );
  return (
    container.querySelector(".integration-tool-parameter") ?? assert.fail("the parameter stands")
  );
}

test("from 440px wide a tool's parameter stands as a grid, its name in a column beside what it is", () => {
  assert.equal(getComputedStyle(parameterAt(440)).display, "grid");
}, 30_000);

test("narrower than 440px a tool's parameter stands as one column, its name over what it is", () => {
  assert.equal(getComputedStyle(parameterAt(439)).display, "flex");
}, 30_000);
