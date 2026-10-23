// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { PageThumb } from "../../index.js";

/**
 * page-thumb.test.ts -- a thumb of a page stays hidden until its frame has
 * loaded and hides again when a newer address is handed it; a thumb of a
 * picture or a glyph is never loading.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a fresh container on the page. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

const frame = (src: string) => ({ title: "A page", src, sandbox: "allow-scripts" });

test("a page's frame shows once it has loaded, and again waits when its address changes", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(PageThumb, { frame: frame("about:blank#1") })));
  const thumb = () => container.querySelector<HTMLElement>(".luke-page-thumb");
  expect(thumb()?.dataset.loaded).toBe("false");
  act(() => {
    container.querySelector("iframe")?.dispatchEvent(new Event("load"));
  });
  expect(thumb()?.dataset.loaded).toBe("true");
  act(() => root.render(createElement(PageThumb, { frame: frame("about:blank#2") })));
  expect(thumb()?.dataset.loaded).toBe("false");
});

test("a frame is inert: out of the tab order and the screen reader's reading", () => {
  const iframe = mount(createElement(PageThumb, { frame: frame("about:blank") })).querySelector(
    "iframe",
  );
  expect(iframe?.tabIndex).toBe(-1);
  expect(iframe?.getAttribute("aria-hidden")).toBe("true");
});

test("a thumb with a glyph is marked missing and holds no frame", () => {
  const thumb = mount(createElement(PageThumb, { glyph: createElement("svg") })).firstElementChild;
  expect(thumb?.hasAttribute("data-missing")).toBe(true);
  expect(thumb?.querySelector("iframe")).toBeNull();
});
