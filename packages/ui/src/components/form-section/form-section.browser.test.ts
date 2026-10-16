import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { BUTTON_TYPE, BUTTON_VARIANT, Button } from "../button/button.js";
import { FormField } from "../form-field/form-field.js";
import { TextField } from "../text-field/text-field.js";
import { FormSection } from "./form-section.js";

/**
 * form-section.browser.test.ts -- a headed form is a landmark its heading
 * names; an Enter in a field and a press of its submit button both submit it
 * without leaving the page, and a plain button does not; the form's error is
 * announced as it arrives and describes the form while a field's error still
 * describes its own control; and the actions follow the fields in the tab
 * order, end at the form's edge, and wrap rather than overflow.
 */

/** A form `width` pixels wide whose save the service refuses, counting its submits. */
function Workspace({ width }: { width: number }): React.JSX.Element {
  const [name, setName] = useState("");
  const [submits, setSubmits] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  return createElement(
    "div",
    { style: { width } },
    createElement(FormSection, {
      title: "Workspace",
      description: "How the workspace is shown to its members.",
      error,
      onSubmit: () => {
        setSubmits((count) => count + 1);
        setError("The workspace could not be saved.");
        setNameError(name === "" ? "Give the workspace a name." : undefined);
      },
      actions: [
        createElement(Button, { key: "cancel", variant: BUTTON_VARIANT.QUIET, children: "Cancel" }),
        createElement(Button, {
          key: "save",
          variant: BUTTON_VARIANT.PRIMARY,
          type: BUTTON_TYPE.SUBMIT,
          children: "Save workspace",
        }),
      ],
      children: [
        createElement(FormField, {
          key: "name",
          label: "Workspace name",
          error: nameError,
          children: (control) =>
            createElement(TextField, { field: control, value: name, onChange: setName }),
        }),
        createElement(FormField, {
          key: "slug",
          label: "Address",
          children: (control) =>
            createElement(TextField, { field: control, value: "acme", onChange: () => {} }),
        }),
      ],
    }),
    createElement("output", null, String(submits)),
  );
}

/** How many submits the form has answered. */
function submits(): string | null | undefined {
  return document.querySelector("output")?.textContent;
}

/** The element `selector` finds in `container`, which must find one. */
function box(container: HTMLElement, selector: string): DOMRect {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return element.getBoundingClientRect();
}

test("a headed form is a landmark its heading names and its words describe", async () => {
  const { container } = await mount(createElement(Workspace, { width: 400 }));
  const form = page.getByRole("form", { name: "Workspace" });
  await expect
    .element(form)
    .toHaveAccessibleDescription("How the workspace is shown to its members.");
  await expect.element(page.getByRole("heading", { level: 2, name: "Workspace" })).toBeVisible();
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("an Enter in a field and a press of the submit button submit the form, and Cancel does not", async () => {
  const at = window.location.href;
  await mount(createElement(Workspace, { width: 400 }));
  await userEvent.type(page.getByRole("textbox", { name: "Workspace name" }), "Acme");
  await userEvent.keyboard("{Enter}");
  expect(submits()).toBe("1");
  await page.getByRole("button", { name: "Save workspace" }).click();
  expect(submits()).toBe("2");
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(submits()).toBe("2");
  expect(window.location.href).toBe(at);
});

test("the form's error is announced as it arrives and describes the form beside a field's own", async () => {
  const { container } = await mount(createElement(Workspace, { width: 400 }));
  const region = container.querySelector(".luke-form-section-error");
  expect(region?.getAttribute("aria-live")).toBe("polite");
  expect(region?.textContent).toBe("");
  await page.getByRole("button", { name: "Save workspace" }).click();
  expect(container.querySelector(".luke-form-section-error")).toBe(region);
  expect(region?.textContent).toBe("The workspace could not be saved.");
  await expect
    .element(page.getByRole("form", { name: "Workspace" }))
    .toHaveAccessibleDescription(
      "How the workspace is shown to its members. The workspace could not be saved.",
    );
  const name = page.getByRole("textbox", { name: "Workspace name" });
  await expect.element(name).toBeInvalid();
  await expect.element(name).toHaveAccessibleDescription("Give the workspace a name.");
  await expect.element(page.getByRole("textbox", { name: "Address" })).not.toBeInvalid();
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("the actions follow the fields in the tab order and end at the form's edge", async () => {
  const { container } = await mount(createElement(Workspace, { width: 400 }));
  await page.getByRole("textbox", { name: "Address" }).click();
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("button", { name: "Save workspace" })).toHaveFocus();
  const form = box(container, "form");
  const [cancel, save] = [...container.querySelectorAll("button")].map((button) =>
    button.getBoundingClientRect(),
  );
  expect(save?.right).toBe(form.right);
  expect(save?.top).toBe(cancel?.top);
});

test("the fields and the actions stand one field's gap apart while no error stands between them", async () => {
  const { container } = await mount(createElement(Workspace, { width: 400 }));
  const [first, second] = [...container.querySelectorAll(".luke-field")].map((field) =>
    field.getBoundingClientRect(),
  );
  const actions = box(container, ".luke-form-section-actions");
  const between = (second?.top ?? 0) - (first?.bottom ?? 0);
  expect(between).toBeGreaterThan(0);
  expect(actions.top - (second?.bottom ?? 0)).toBe(between);
});

test("actions too wide for a narrow form wrap inside it rather than overflow", async () => {
  const { container } = await mount(createElement(Workspace, { width: 160 }));
  const form = box(container, "form");
  const [cancel, save] = [...container.querySelectorAll("button")].map((button) =>
    button.getBoundingClientRect(),
  );
  expect(save?.top).toBeGreaterThanOrEqual(cancel?.bottom ?? Number.POSITIVE_INFINITY);
  expect(save?.right).toBeLessThanOrEqual(form.right);
  expect(cancel?.right).toBeLessThanOrEqual(form.right);
});

test("a form with no heading or words is no landmark and is described by nothing", async () => {
  const { container } = await mount(
    createElement(FormSection, {
      onSubmit: () => {},
      children: createElement(FormField, {
        label: "Name",
        children: (control) =>
          createElement(TextField, { field: control, value: "", onChange: () => {} }),
      }),
    }),
  );
  await expect.element(page.getByRole("form")).not.toBeInTheDocument();
  expect(container.querySelector("h2")).toBeNull();
  expect(container.querySelector("form")?.hasAttribute("aria-describedby")).toBe(false);
  expect(await accessibilityViolations(container)).toEqual([]);
});
