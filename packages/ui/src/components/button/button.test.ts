// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { BUTTON_VARIANT, Button, ButtonLink, IconButton } from "./button.js";

/**
 * button.test.ts -- a ButtonLink is a link a reader finds by its words,
 * going where its address says, and its press is heard before the browser
 * follows it. A button that is not tabbable is left out of the tab order,
 * yet takes the focus a roving group hands it and is pressed as any other;
 * an ordinary button stays a Tab stop. A button that keeps focus leaves it
 * on the field that held it when a pointer presses it.
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

test("a button that is not tabbable is skipped by Tab, yet takes the focus handed to it and its press", () => {
  const pressed: string[] = [];
  const container = mount(
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
  const [save, more] = Array.from(container.querySelectorAll("button"));

  expect(save?.tabIndex).toBe(0);
  expect(more?.tabIndex).toBe(-1);

  act(() => more?.focus());
  expect(document.activeElement).toBe(more);
  act(() => more?.click());
  expect(pressed).toEqual(["Section actions"]);
});

test("a button that keeps focus, pressed with the pointer, leaves the focus on the field and is pressed", () => {
  const pressed: string[] = [];
  const container = mount(
    createElement(
      "div",
      null,
      createElement("input", { "aria-label": "Search" }),
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "Back",
        keepFocus: true,
        onClick: () => pressed.push("Back"),
      }),
      createElement(Button, { onClick: () => pressed.push("Connect"), children: "Connect" }),
    ),
  );
  const field = container.querySelector("input");
  const [back, connect] = Array.from(container.querySelectorAll("button"));
  if (field === null || back === undefined || connect === undefined) throw new Error("not drawn");
  act(() => field.focus());

  // Note that jsdom moves no focus on a mousedown, so the browser's move is read as the press's default action.
  const press = (button: HTMLButtonElement) => {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      button.dispatchEvent(down);
      if (!down.defaultPrevented) button.focus();
      button.click();
    });
  };

  press(back);
  expect(document.activeElement).toBe(field);
  press(connect);
  expect(document.activeElement).toBe(connect);
  expect(pressed).toEqual(["Back", "Connect"]);
});
