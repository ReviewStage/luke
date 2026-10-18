// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { TEXT_LINK_CURRENT, TEXT_LINK_LOOK, TextLink } from "./text-link.js";

/**
 * text-link.test.ts -- a TextLink is a link a reader finds by its words,
 * going where its address says; only the link to where the reader is is
 * announced as current, as the page or as the part of the site; an external
 * link in a new tab opens there and is still named by its words alone; a
 * link with no address is its words and no link; and its press is heard
 * before the browser follows it.
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

test("a TextLink is a link named by its words, going to its address", () => {
  const container = mount(createElement(TextLink, { href: "/about", children: "About" }));

  const links = Array.from(container.querySelectorAll("a"));
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["About", "/about"],
  ]);
  expect(links[0]?.hasAttribute("target")).toBe(false);
});

test("only the link to where the reader is is announced current, as the page or the part of the site", () => {
  const container = mount(
    createElement(
      "nav",
      null,
      createElement(TextLink, {
        href: "/about",
        current: TEXT_LINK_CURRENT.PAGE,
        children: "About",
      }),
      createElement(TextLink, {
        href: "/changelog",
        current: TEXT_LINK_CURRENT.SECTION,
        children: "Changelog",
      }),
      createElement(TextLink, { href: "/privacy", children: "Privacy" }),
    ),
  );

  const links = Array.from(container.querySelectorAll("a"));
  expect(links.map((link) => [link.textContent, link.getAttribute("aria-current")])).toEqual([
    ["About", "page"],
    ["Changelog", "true"],
    ["Privacy", null],
  ]);
});

test("an external link in a new tab opens there and is named by its words, not its glyph", () => {
  const container = mount(
    createElement(TextLink, {
      href: "https://example.com/console",
      look: TEXT_LINK_LOOK.UNDERLINED,
      external: true,
      newTab: true,
      children: "the analytics processor",
    }),
  );

  const link = container.querySelector("a");
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noreferrer");
  expect(link?.textContent).toBe("the analytics processor");
  expect(link?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
});

test("a press on a TextLink is heard, and the link is still followed", () => {
  const presses: boolean[] = [];
  const container = mount(
    createElement(TextLink, {
      href: "/admin/users",
      onClick: (event) => presses.push(event.defaultPrevented),
      children: "Users",
    }),
  );
  const link = container.querySelector("a");
  // Note that jsdom cannot follow a link, so the page stops it once the press has bubbled past the component.
  document.addEventListener("click", (event) => event.preventDefault(), { once: true });

  act(() => link?.click());

  expect(presses).toEqual([false]);
});

test("a TextLink with no address is its words, and no link", () => {
  const container = mount(
    createElement(TextLink, {
      href: undefined,
      look: TEXT_LINK_LOOK.UNDERLINED,
      children: "the docs",
    }),
  );

  expect(container.querySelector("a")).toBeNull();
  expect(container.textContent).toBe("the docs");
});
