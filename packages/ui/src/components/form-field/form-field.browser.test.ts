import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { FormField } from "./form-field.js";

/**
 * form-field.browser.test.ts -- a field's words are its control's: the label
 * names it and takes the keyboard to it when pressed, the description and an
 * error describe it, and an error marks it invalid and is announced as it
 * arrives.
 */

/** A name field that says it is empty once a check finds it so. */
function NameField(): React.JSX.Element {
  const [error, setError] = useState<string | undefined>(undefined);
  return createElement(
    "div",
    null,
    createElement(FormField, {
      label: "Workspace name",
      description: "Everyone in the workspace sees it.",
      error,
      children: (control) => createElement("input", { ...control, type: "text" }),
    }),
    createElement(
      "button",
      { type: "button", onClick: () => setError("Give the workspace a name.") },
      "Check",
    ),
  );
}

test("the label names the control and a press on it takes the keyboard there", async () => {
  await mount(createElement(NameField));
  const input = page.getByRole("textbox", { name: "Workspace name" });
  await expect.element(input).toHaveAccessibleDescription("Everyone in the workspace sees it.");
  await page.getByText("Workspace name").click();
  await expect.element(input).toHaveFocus();
});

test("an error marks the control invalid, describes it, and is announced as it arrives", async () => {
  const { container } = await mount(createElement(NameField));
  const region = container.querySelector('[aria-live="polite"]');
  expect(region?.textContent).toBe("");
  await page.getByRole("button", { name: "Check" }).click();
  const input = page.getByRole("textbox", { name: "Workspace name" });
  await expect.element(input).toBeInvalid();
  await expect
    .element(input)
    .toHaveAccessibleDescription("Everyone in the workspace sees it. Give the workspace a name.");
  expect(container.querySelector('[aria-live="polite"]')).toBe(region);
  expect(region?.textContent).toBe("Give the workspace a name.");
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("a field with no description or error describes its control with nothing", async () => {
  await mount(
    createElement(FormField, {
      label: "Name",
      children: (control) => createElement("input", { ...control, type: "text" }),
    }),
  );
  await userEvent.keyboard("{Tab}");
  const input = page.getByRole("textbox", { name: "Name" });
  await expect.element(input).toHaveFocus();
  await expect.element(input).not.toHaveAttribute("aria-describedby");
  await expect.element(input).not.toHaveAttribute("aria-invalid");
});
