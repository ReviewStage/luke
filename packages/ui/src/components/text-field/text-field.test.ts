// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { FormField } from "../form-field/form-field.js";
import { TextArea, TextField } from "./text-field.js";

/**
 * text-field.test.ts -- a text entry draws the value its caller holds and
 * hands every change back, answers Enter only when no input method is
 * composing, stays out of spell check where asked, and inside a field is named, described, and marked invalid by
 * the field's words.
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

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** Types `value` into `field` as the page would hand it to React. */
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(field: HTMLElement, init: KeyboardEventInit): void {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

/** A name the caller holds, with a way to clear it and a count of Enters. */
function Name(): React.JSX.Element {
  const [name, setName] = useState("");
  const [enters, setEnters] = useState(0);
  return createElement(
    "div",
    null,
    createElement(TextField, {
      label: "Name",
      value: name,
      onChange: setName,
      onEnter: () => setEnters((count) => count + 1),
    }),
    createElement("button", { type: "button", onClick: () => setName("") }, "Clear"),
    createElement("output", { "data-name": name }, String(enters)),
  );
}

function fieldNamed(page: HTMLElement, name: string): HTMLInputElement {
  const field = page.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
  return field ?? assert.fail(`no field named ${name}`);
}

test("a text field draws what its caller holds and hands back every change", () => {
  const page = render(createElement(Name));
  const field = fieldNamed(page, "Name");
  type(field, "Ada");
  assert.equal(page.querySelector("output")?.getAttribute("data-name"), "Ada");
  act(() => page.querySelector("button")?.click());
  assert.equal(field.value, "");
});

test("Enter answers onEnter, except the Enter that commits an input method's composition", () => {
  const page = render(createElement(Name));
  const field = fieldNamed(page, "Name");
  press(field, { key: "Enter" });
  press(field, { key: "Enter", isComposing: true });
  press(field, { key: "Enter", keyCode: 229 });
  assert.equal(page.querySelector("output")?.textContent, "1");
});

test("a text area holds the many lines its caller holds and hands back every change", () => {
  function Notes(): React.JSX.Element {
    const [notes, setNotes] = useState("");
    return createElement(
      "div",
      null,
      createElement(TextArea, { label: "Notes", value: notes, onChange: setNotes }),
      createElement("output", null, notes.split("\n").length),
    );
  }
  const page = render(createElement(Notes));
  const area = page.querySelector("textarea") ?? assert.fail("no text area");
  type(area, "One\nTwo");
  assert.equal(page.querySelector("output")?.textContent, "2");
  assert.equal(area.value, "One\nTwo");
});

test("a text entry asked not to is left out of the system's spell check, and is checked otherwise", () => {
  const page = render(
    createElement(
      "div",
      null,
      createElement(TextField, {
        label: "Name",
        value: "",
        onChange: () => undefined,
        spellCheck: false,
      }),
      createElement(TextArea, {
        label: "Code",
        value: "",
        onChange: () => undefined,
        spellCheck: false,
      }),
      createElement(TextField, { label: "Note", value: "", onChange: () => undefined }),
    ),
  );
  assert.equal(fieldNamed(page, "Name").getAttribute("spellcheck"), "false");
  assert.equal(page.querySelector("textarea")?.getAttribute("spellcheck"), "false");
  assert.equal(fieldNamed(page, "Note").getAttribute("spellcheck"), null);
});

test("inside a field, a text entry is named, described, and marked invalid by the field's words", () => {
  const page = render(
    createElement(FormField, {
      label: "Workspace name",
      description: "Everyone sees it.",
      error: "Give it a name.",
      children: (field) =>
        createElement(TextField, { field, value: "", onChange: () => undefined }),
    }),
  );
  const field = page.querySelector("input") ?? assert.fail("no field");
  assert.equal(page.querySelector(`label[for="${field.id}"]`)?.textContent, "Workspace name");
  const described = (field.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");
  assert.equal(described, "Everyone sees it. Give it a name.");
  assert.equal(field.getAttribute("aria-invalid"), "true");
});

test("a text entry is named by its field or by a label of its own, and never by neither", () => {
  // @ts-expect-error A text entry with neither a field nor a label would stand unnamed.
  createElement(TextField, { value: "", onChange: () => undefined });
  // @ts-expect-error A text area with neither a field nor a label would stand unnamed.
  createElement(TextArea, { value: "", onChange: () => undefined });
});
