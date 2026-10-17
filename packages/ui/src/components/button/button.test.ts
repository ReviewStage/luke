// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { BUTTON_VARIANT, ButtonLink } from "./button.js";

/**
 * button.test.ts -- a ButtonLink is a link a reader finds by its words,
 * going where its address says, and its press is heard before the browser
 * follows it.
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

test("a ButtonLink is a link named by its words, going to its address", () => {
  const container = mount(
    createElement(ButtonLink, {
      href: "https://example.com/luke.dmg",
      variant: BUTTON_VARIANT.PRIMARY,
      icon: createElement("svg", { "aria-hidden": true }),
      children: "Download for macOS",
    }),
  );

  const links = Array.from(container.querySelectorAll("a"));
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Download for macOS", "https://example.com/luke.dmg"],
  ]);
  expect(container.querySelector("button")).toBeNull();
});

test("a press on a ButtonLink is heard, and the link is still followed", () => {
  const presses: boolean[] = [];
  const container = mount(
    createElement(ButtonLink, {
      href: "tryluke://tryluke.dev/acme",
      onClick: (event) => presses.push(event.defaultPrevented),
      children: "Open in Luke",
    }),
  );
  const link = container.querySelector("a");
  expect(link).not.toBeNull();
  // Note that jsdom cannot follow a link, so the page stops it once the press has bubbled past the component.
  document.addEventListener("click", (event) => event.preventDefault(), { once: true });

  act(() => link?.click());

  expect(presses).toEqual([false]);
});
