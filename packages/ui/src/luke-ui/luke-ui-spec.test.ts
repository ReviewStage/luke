// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { LukeUiSpec } from "./luke-ui-spec.js";

/**
 * luke-ui-spec.test.ts -- a spec naming a component outside the catalog is
 * drawn as its fallback, the fence's code, where json-render's renderer
 * alone would draw nothing for it.
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

test("a spec naming a component outside the catalog is drawn as its code", () => {
  const code = JSON.stringify({
    root: "card",
    elements: {
      card: { type: "Card", props: { title: "Deploy" }, children: ["confirm"] },
      confirm: { type: "Button", props: { label: "Ship it" } },
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(createElement(LukeUiSpec, { code, fallback: createElement("pre", null, code) })),
  );
  expect(container.textContent).toBe(code);
});
