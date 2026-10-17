// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Button, IconButton } from "./button.js";

/**
 * button.test.ts -- a button that is not tabbable is left out of the tab
 * order, yet takes the focus a roving group hands it and is pressed as any
 * other; an ordinary button stays a Tab stop.
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

/** Draws `element` into a container in the document and hands the container back. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The button `container` holds, named `name`. */
function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  if (button === undefined) throw new Error(`no button named ${name}`);
  return button;
}

test("a button that is not tabbable is skipped by Tab, yet takes the focus handed to it and its press", () => {
  const pressed: string[] = [];
  const container = draw(
    createElement(
      "div",
      null,
      createElement(Button, { onClick: () => pressed.push("Save"), children: "Save" }),
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "Section actions",
        tabbable: false,
        onClick: () => pressed.push("Section actions"),
      }),
    ),
  );
  const save = buttonNamed(container, "Save");
  const more = buttonNamed(container, "Section actions");

  expect(save.tabIndex).toBe(0);
  expect(more.tabIndex).toBe(-1);

  act(() => more.focus());
  expect(document.activeElement).toBe(more);
  act(() => more.click());
  expect(pressed).toEqual(["Section actions"]);
});
