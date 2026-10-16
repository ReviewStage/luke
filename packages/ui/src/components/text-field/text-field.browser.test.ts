import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { FormField } from "../form-field/form-field.js";
import { TextArea, TextField } from "./text-field.js";

/**
 * text-field.browser.test.ts -- a text entry draws the value its caller
 * holds and hands every change back, answers Enter only when no input method
 * is composing, and inside a field is named, described, and marked invalid
 * by the field's words.
 */

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

function held(): string | null | undefined {
  return document.querySelector("output")?.getAttribute("data-name");
}

test("a text field draws what its caller holds and hands back every change", async () => {
  await mount(createElement(Name));
  const field = page.getByRole("textbox", { name: "Name" });
  await userEvent.type(field, "Ada");
  expect(held()).toBe("Ada");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect.element(field).toHaveValue("");
});

test("Enter answers onEnter, except the Enter that commits an input method's composition", async () => {
  await mount(createElement(Name));
  const field = page.getByRole("textbox", { name: "Name" });
  await userEvent.type(field, "Ada");
  await userEvent.keyboard("{Enter}");
  expect(document.querySelector("output")?.textContent).toBe("1");
  field
    .element()
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
  field
    .element()
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }));
  expect(document.querySelector("output")?.textContent).toBe("1");
});

test("a text area holds many lines, Enter starting the next", async () => {
  function Notes(): React.JSX.Element {
    const [notes, setNotes] = useState("");
    return createElement(TextArea, { label: "Notes", value: notes, onChange: setNotes });
  }
  await mount(createElement(Notes));
  const area = page.getByRole("textbox", { name: "Notes" });
  await userEvent.type(area, "One{Enter}Two");
  await expect.element(area).toHaveValue("One\nTwo");
});

test("inside a field, a text entry is named, described, and marked invalid by the field's words", async () => {
  const { container } = await mount(
    createElement(FormField, {
      label: "Workspace name",
      description: "Everyone sees it.",
      error: "Give it a name.",
      children: (field) =>
        createElement(TextField, { field, value: "", onChange: () => undefined }),
    }),
  );
  const field = page.getByRole("textbox", { name: "Workspace name" });
  await expect.element(field).toBeInvalid();
  await expect.element(field).toHaveAccessibleDescription("Everyone sees it. Give it a name.");
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("a text entry is named by its field or by a label of its own, and never by neither", () => {
  // @ts-expect-error A text entry with neither a field nor a label would stand unnamed.
  createElement(TextField, { value: "", onChange: () => undefined });
  // @ts-expect-error A text area with neither a field nor a label would stand unnamed.
  createElement(TextArea, { value: "", onChange: () => undefined });
});
