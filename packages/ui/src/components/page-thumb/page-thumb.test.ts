// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { PageThumb } from "../../index.js";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

const frame = (src: string) => ({ title: "A page", src, sandbox: "allow-scripts" });

test("a frame is inert: out of the tab order and the screen reader's reading", () => {
  const iframe = mount(createElement(PageThumb, { frame: frame("about:blank") })).querySelector(
    "iframe",
  );
  expect(iframe?.tabIndex).toBe(-1);
  expect(iframe?.getAttribute("aria-hidden")).toBe("true");
});

test("a thumb with a glyph holds no frame", () => {
  const thumb = mount(createElement(PageThumb, { glyph: createElement("svg") })).firstElementChild;
  expect(thumb?.querySelector("iframe")).toBeNull();
});
