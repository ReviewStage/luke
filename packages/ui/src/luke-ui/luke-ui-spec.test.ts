// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { LukeUiSpec } from "./luke-ui-spec.js";

/**
 * luke-ui-spec.test.ts -- a spec the catalog refuses is drawn as its
 * fallback, the fence's code, where json-render's renderer alone would draw
 * what it could of it and drop the rest unseen: a component outside the
 * catalog, or a table row whose cells do not match its columns.
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

test.each([
  {
    refused: "a component outside the catalog",
    spec: {
      root: "card",
      elements: {
        card: { type: "Card", props: { title: "Deploy" }, children: ["confirm"] },
        confirm: { type: "Button", props: { label: "Ship it" } },
      },
    },
  },
  {
    refused: "a table row with a cell past its columns",
    spec: {
      root: "checks",
      elements: {
        checks: {
          type: "Table",
          props: {
            label: "Checks",
            columns: [{ label: "Check" }, { label: "Runs", numeric: true }],
            rows: [["Lint", 2, "Failed"]],
          },
        },
      },
    },
  },
])("a spec naming $refused is drawn as its code", ({ spec }) => {
  const code = JSON.stringify(spec);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(createElement(LukeUiSpec, { code, fallback: createElement("pre", null, code) })),
  );
  expect(container.textContent).toBe(code);
});
