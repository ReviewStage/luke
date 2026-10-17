// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { BUTTON_SHAPE, BUTTON_VARIANT, Button, IconButton } from "./button.js";

/**
 * button.test.ts -- a button that is not tabbable is left out of the tab
 * order, yet takes the focus a roving group hands it and is pressed as any
 * other; an ordinary button stays a Tab stop. A button that keeps focus
 * leaves it on the field that held it when a pointer presses it.
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

test("a button that keeps focus, pressed with the pointer, leaves the focus on the field and is pressed", () => {
  const pressed: string[] = [];
  const container = draw(
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
  if (field === null) throw new Error("no field");
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

  press(buttonNamed(container, "Back"));
  expect(document.activeElement).toBe(field);
  press(buttonNamed(container, "Connect"));
  expect(document.activeElement).toBe(buttonNamed(container, "Connect"));
  expect(pressed).toEqual(["Back", "Connect"]);
});

test("a toggle is announced pressed while it is on, in any look, and a plain button as no toggle at all", () => {
  const container = draw(
    createElement(
      "div",
      null,
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "Mute microphone",
        variant: BUTTON_VARIANT.DANGER,
        shape: BUTTON_SHAPE.ROUND,
        pressed: false,
      }),
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "Unmute speaker",
        variant: BUTTON_VARIANT.DANGER,
        shape: BUTTON_SHAPE.ROUND,
        pressed: true,
      }),
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "End call",
        variant: BUTTON_VARIANT.INK,
        shape: BUTTON_SHAPE.ROUND,
      }),
    ),
  );

  expect(buttonNamed(container, "Mute microphone").getAttribute("aria-pressed")).toBe("false");
  expect(buttonNamed(container, "Unmute speaker").getAttribute("aria-pressed")).toBe("true");
  expect(buttonNamed(container, "End call").hasAttribute("aria-pressed")).toBe(false);
});
