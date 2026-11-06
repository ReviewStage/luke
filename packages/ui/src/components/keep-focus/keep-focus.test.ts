// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { KeepFocus } from "./keep-focus.js";

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

function mount(): { box: HTMLElement; pressed: string[] } {
  const pressed: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(KeepFocus, {
        "aria-label": "Crumb",
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

function movesFocus(target: Element): boolean {
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(down);
  });
  return !down.defaultPrevented;
}

test("a box keeps the focus at a press on its words and on its control", () => {
  const { box, pressed } = mount();
  expect(movesFocus(box.querySelector("span") ?? box)).toBe(false);
  const back = box.querySelector("button") ?? box;
  expect(movesFocus(back)).toBe(false);
  act(() => back.click());
  expect(pressed).toEqual(["back"]);
});
