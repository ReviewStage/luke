// @vitest-environment jsdom

import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { Switch } from "../switch/switch.js";
import { SettingsRow } from "./settings-row.js";

/**
 * settings-row.test.ts -- a row's words are its control's: its label names
 * the control, its description and a failed write describe it, and the
 * failure marks it invalid and is announced in the region that stood empty
 * before it arrived.
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

/** Draws `element` into a fresh container in the document. */
function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The words the elements an attribute's ids name say, in order, as a reader reads them. */
function wordsOf(element: Element, attribute: string): string {
  return (element.getAttribute(attribute) ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

/** A row whose switch's write is refused once pressed, as a settings write can be. */
function RefusedRow(): React.JSX.Element {
  const [error, setError] = useState<string | undefined>(undefined);
  return createElement(SettingsRow, {
    label: "Show captions",
    description: "Words the call hears stand under its video.",
    error,
    children: (control) =>
      createElement(Switch, {
        checked: false,
        label: "Show captions",
        describedBy: control["aria-describedby"],
        "aria-invalid": control["aria-invalid"],
        onChange: () => setError("The setting could not be saved."),
      }),
  });
}

test("the label's id names a control and the description describes it", () => {
  const container = mount(
    createElement(SettingsRow, {
      label: "Launch at login",
      description: "Luke opens with the Mac.",
      children: (control) =>
        createElement("input", {
          type: "checkbox",
          "aria-labelledby": control.labelId,
          "aria-describedby": control["aria-describedby"],
          "aria-invalid": control["aria-invalid"],
        }),
    }),
  );
  const box = container.querySelector('input[type="checkbox"]');
  if (box === null) throw new Error("no checkbox");
  expect(wordsOf(box, "aria-labelledby")).toBe("Launch at login");
  expect(wordsOf(box, "aria-describedby")).toBe("Luke opens with the Mac.");
  expect(box.hasAttribute("aria-invalid")).toBe(false);
});

test("a refused write marks the control invalid, describes it, and is announced as it arrives", () => {
  const container = mount(createElement(RefusedRow));
  const region = container.querySelector('[aria-live="polite"]');
  expect(region?.textContent).toBe("");
  const control = container.querySelector<HTMLButtonElement>('button[role="switch"]');
  if (control === null) throw new Error("no switch");
  expect(control.hasAttribute("aria-invalid")).toBe(false);
  act(() => control.click());
  expect(control.getAttribute("aria-invalid")).toBe("true");
  expect(wordsOf(control, "aria-describedby")).toBe(
    "Words the call hears stand under its video. The setting could not be saved.",
  );
  expect(container.querySelector('[aria-live="polite"]')).toBe(region);
  expect(region?.textContent).toBe("The setting could not be saved.");
});

test("an empty description and error say nothing, so the control is neither described nor invalid", () => {
  const container = mount(
    createElement(SettingsRow, {
      label: "Sign out",
      description: "",
      error: null,
      children: (control) =>
        createElement(Button, {
          "aria-describedby": control["aria-describedby"],
          children: "Sign out",
        }),
    }),
  );
  const button = container.querySelector("button");
  expect(button?.textContent).toBe("Sign out");
  expect(button?.hasAttribute("aria-describedby")).toBe(false);
  expect(container.textContent).toBe("Sign outSign out");
});

test("a leading mark stands in the row but names nothing: the label alone names the control", () => {
  const container = mount(
    createElement(SettingsRow, {
      label: "ada@example.com",
      leading: createElement("span", null, "A"),
      children: (control) =>
        createElement("input", { type: "checkbox", "aria-labelledby": control.labelId }),
    }),
  );
  const box = container.querySelector('input[type="checkbox"]');
  if (box === null) throw new Error("no checkbox");
  expect(container.textContent).toContain("A");
  expect(wordsOf(box, "aria-labelledby")).toBe("ada@example.com");
});

test("an adornment rides the label's line but names nothing: the label alone names the control", () => {
  const container = mount(
    createElement(SettingsRow, {
      label: "Theme",
      adornment: createElement("span", null, "Modified"),
      children: (control) =>
        createElement("input", { type: "checkbox", "aria-labelledby": control.labelId }),
    }),
  );
  const box = container.querySelector('input[type="checkbox"]');
  if (box === null) throw new Error("no checkbox");
  expect(container.textContent).toContain("Modified");
  expect(wordsOf(box, "aria-labelledby")).toBe("Theme");
});

test("what a row grows below its line is read after the row's words, and its error after that", () => {
  const container = mount(
    createElement(SettingsRow, {
      label: "Anthropic",
      error: "The key was refused.",
      below: createElement("input", { "aria-label": "Anthropic API key" }),
      children: () => createElement(Button, { children: "Add key" }),
    }),
  );
  const words = container.textContent ?? "";
  const field = container.querySelector('input[aria-label="Anthropic API key"]');
  const error = container.querySelector('[aria-live="polite"]');
  if (field === null || error === null) throw new Error("no field or error");
  expect(words.indexOf("Add key")).toBeLessThan(words.indexOf("The key was refused."));
  expect(field.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
