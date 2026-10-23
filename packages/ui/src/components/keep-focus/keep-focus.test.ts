// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { KEEP_FOCUS, KeepFocus, type KeepFocusScope } from "./keep-focus.js";

/**
 * keep-focus.test.ts -- a press in the box leaves the focus where it stood:
 * anywhere in it when it keeps the whole, on a control alone when it keeps
 * its controls, and nowhere when it keeps none; the control's own press
 * still lands.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A box over `scope` holding words and a button, whose presses are recorded. */
function mount(scope?: KeepFocusScope): { box: HTMLElement; pressed: string[] } {
  const pressed: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(KeepFocus, {
        "aria-label": "Crumb",
        ...(scope === undefined ? {} : { scope }),
        children: [
          createElement("span", { key: "words" }, "Files"),
          createElement(Button, {
            key: "back",
            onClick: () => pressed.push("back"),
            children: "Back",
          }),
        ],
      }),
    ),
  );
  const box = container.querySelector<HTMLElement>("[aria-label=Crumb]");
  if (box === null) throw new Error("the box is drawn");
  return { box, pressed };
}

/** Whether a mouse press on `target` would move the focus, as the platform's default does. */
function movesFocus(target: Element): boolean {
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(down);
  });
  return !down.defaultPrevented;
}

test("a box that keeps the whole keeps the focus at a press on its words and on its control", () => {
  const { box, pressed } = mount();
  expect(movesFocus(box.querySelector("span") ?? box)).toBe(false);
  const back = box.querySelector("button") ?? box;
  expect(movesFocus(back)).toBe(false);
  act(() => back.click());
  expect(pressed).toEqual(["back"]);
});

test("a box that keeps its controls lets a press on its words move the focus", () => {
  const { box } = mount(KEEP_FOCUS.CONTROLS);
  expect(movesFocus(box.querySelector("span") ?? box)).toBe(true);
  expect(movesFocus(box.querySelector("button") ?? box)).toBe(false);
});

test("a box that keeps none leaves every press its own way", () => {
  const { box } = mount(KEEP_FOCUS.NONE);
  expect(movesFocus(box.querySelector("button") ?? box)).toBe(true);
});
