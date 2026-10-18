// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { TEXT_BUTTON_TONE, TextButton } from "./text-button.js";

/**
 * text-button.test.ts -- a text button is a button a reader finds by its
 * words, or by the name it is handed, and a press acts without submitting
 * the form it stands in. One that shows a region says whether that stands
 * open and which it is. One that keeps focus leaves it on the field that
 * held it when a pointer presses it.
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

test("a text button is a button named by its words, or by its label, and acts without submitting its form", () => {
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
      createElement(TextButton, {
        tone: TEXT_BUTTON_TONE.LINK,
        onClick: () => pressed.push("feedback"),
        children: "Send feedback",
      }),
      createElement(TextButton, {
        "aria-label": "Show Vercel tools",
        onClick: () => pressed.push("tools"),
        children: "12 tools",
      }),
    ),
  );
  const buttons = Array.from(container.querySelectorAll("button"));

  expect(buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
    "Send feedback",
    "Show Vercel tools",
  ]);
  for (const button of buttons) act(() => button.click());
  expect(pressed).toEqual(["feedback", "tools"]);
  expect(submitted).toEqual([]);
});

test("a text button that shows a region says whether it stands open, and which region it is", () => {
  function Thread(): React.JSX.Element {
    const [open, setOpen] = useState(false);
    return createElement(
      "div",
      null,
      createElement(TextButton, {
        tone: TEXT_BUTTON_TONE.ACCENT,
        "aria-expanded": open,
        "aria-controls": "replies",
        onClick: () => setOpen((was) => !was),
        children: open ? "Hide replies" : "3 replies",
      }),
      open ? createElement("ul", { id: "replies" }) : null,
    );
  }
  const container = mount(createElement(Thread));
  const toggle = container.querySelector("button");
  if (toggle === null) throw new Error("not drawn");

  expect([toggle.textContent, toggle.getAttribute("aria-expanded")]).toEqual([
    "3 replies",
    "false",
  ]);
  act(() => toggle.click());
  expect([toggle.textContent, toggle.getAttribute("aria-expanded")]).toEqual([
    "Hide replies",
    "true",
  ]);
  expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")).not.toBeNull();
});

test("a text button that keeps focus, pressed with the pointer, leaves the focus on the field and is pressed", () => {
  const pressed: string[] = [];
  const container = mount(
    createElement(
      "div",
      null,
      createElement("input", { "aria-label": "Reply" }),
      createElement(TextButton, {
        keepFocus: true,
        onClick: () => pressed.push("quote"),
        children: "the quoted line",
      }),
      createElement(TextButton, { onClick: () => pressed.push("cancel"), children: "Cancel" }),
    ),
  );
  const field = container.querySelector("input");
  const [quote, cancel] = Array.from(container.querySelectorAll("button"));
  if (field === null || quote === undefined || cancel === undefined) throw new Error("not drawn");
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

  press(quote);
  expect(document.activeElement).toBe(field);
  press(cancel);
  expect(document.activeElement).toBe(cancel);
  expect(pressed).toEqual(["quote", "cancel"]);
});
