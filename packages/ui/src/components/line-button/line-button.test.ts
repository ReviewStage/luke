// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Disclosure, DisclosureBody } from "../disclosure/disclosure.js";
import { LINE_BUTTON_LOOK, LineButton, LineSummary } from "./line-button.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

test("a line button is named by its words, carries its caller's marks, and acts without submitting its form", () => {
  const pressed: string[] = [];
  const submitted: string[] = [];
  const container = mount(
    createElement(
      "form",
      {
        onSubmit: (event: SubmitEvent) => {
          event.preventDefault();
          submitted.push("form");
        },
      },
      createElement(LineButton, {
        "data-call-id": "call-1",
        onClick: () => pressed.push("row"),
        children: "Opened the pull request",
      }),
      createElement(LineButton, {
        look: LINE_BUTTON_LOOK.QUOTE,
        onClick: () => pressed.push("quote"),
        children: "the retry loop starts here",
      }),
    ),
  );
  const buttons = Array.from(container.querySelectorAll("button"));

  expect(buttons.map((button) => button.textContent)).toEqual([
    "Opened the pull request",
    "the retry loop starts here",
  ]);
  expect(container.querySelector('button[data-call-id="call-1"]')).toBe(buttons[0]);
  for (const button of buttons) act(() => button.click());
  expect(pressed).toEqual(["row", "quote"]);
  expect(submitted).toEqual([]);
});

test("a line summary opens and closes its fold, says whether it stands open, and draws the body only while it does", () => {
  const container = mount(
    createElement(
      Disclosure,
      null,
      createElement(LineSummary, { "data-call-id": "call-2", children: "Thought" }),
      createElement(DisclosureBody, null, createElement("p", null, "the reasoning")),
    ),
  );
  const summary = container.querySelector('summary[data-call-id="call-2"]');
  if (!(summary instanceof HTMLElement)) throw new Error("not drawn");
  const read = () => [
    summary.getAttribute("aria-expanded"),
    container.querySelector("p")?.textContent,
  ];

  expect(read()).toEqual(["false", undefined]);
  act(() => summary.click());
  expect(read()).toEqual(["true", "the reasoning"]);
});
