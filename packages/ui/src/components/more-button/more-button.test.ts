// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Menu, useMenu } from "../menu/menu.js";
import { MoreButton } from "./more-button.js";

/**
 * more-button.test.ts -- a header's ⋯ is named "{Thing} actions" for what
 * it acts on, drops the menu its owner keeps and says so, and closes it
 * again on a second press; one unavailable drops nothing. Synthetic
 * automation.
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

/** An automation's header ⋯ and the menu it drops. */
function Header({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const menu = useMenu(true);
  return createElement(
    "div",
    null,
    createElement(MoreButton, { thing: "Automation", disabled, ...menu.trigger() }),
    menu.drawn === undefined
      ? null
      : createElement(Menu, {
          label: "Automation actions",
          menu: menu.drawn,
          groups: [[{ label: "Rename", onSelect: () => undefined }]],
          onClose: menu.close,
        }),
  );
}

function draw(element: React.ReactElement): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

function more(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>("button");
  if (found === null) throw new Error("No ⋯");
  return found;
}

test("a ⋯ is named for the thing it acts on", () => {
  draw(createElement(MoreButton, { thing: "Repository" }));
  expect(more().getAttribute("aria-label")).toBe("Repository actions");
});

test("pressing the ⋯ drops its menu and says so, and pressing it again closes it", () => {
  draw(createElement(Header));
  expect(more().getAttribute("aria-haspopup")).toBe("menu");
  expect(more().getAttribute("aria-expanded")).toBe("false");
  act(() => more().click());
  expect(more().getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe(
    "Automation actions",
  );
  act(() => more().click());
  expect(more().getAttribute("aria-expanded")).toBe("false");
});

test("an unavailable ⋯ drops nothing", () => {
  draw(createElement(Header, { disabled: true }));
  act(() => more().click());
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

test("a ⋯ that is not tabbable stays out of the tab order but still opens its menu", () => {
  draw(createElement(MoreButton, { thing: "Section", tabbable: false }));
  expect(more().tabIndex).toBe(-1);
});
