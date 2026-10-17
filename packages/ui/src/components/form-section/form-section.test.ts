// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { BUTTON_TYPE, BUTTON_VARIANT, Button } from "../button/button.js";
import { FormField } from "../form-field/form-field.js";
import { TextField } from "../text-field/text-field.js";
import { FormSection } from "./form-section.js";

/**
 * form-section.test.ts -- a headed form is named by its heading and
 * described by its words; a press of its submit button submits it and a
 * plain button does not; the form's error is announced into a region that
 * stood from the first render and describes the form while a field's error
 * describes its own control; and the actions follow the fields.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a fresh container in the document. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  act(() => root.render(element));
  return container;
}

/** The words the elements `ids` name, as a reader joins them. */
function wordsOf(ids: string | null): string {
  return (ids ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

/** The one element `selector` finds in `container`. */
function one<E extends Element>(container: HTMLElement, selector: string): E {
  const element = container.querySelector<E>(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return element;
}

/** The button whose words are `name`. */
function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === name);
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

/** A form whose save the service refuses, counting its submits. */
function Workspace(): React.JSX.Element {
  const [submits, setSubmits] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  return createElement(
    "div",
    null,
    createElement(FormSection, {
      title: "Workspace",
      description: "How the workspace is shown to its members.",
      error,
      onSubmit: () => {
        setSubmits((count) => count + 1);
        setError("The workspace could not be saved.");
        setNameError("Give the workspace a name.");
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
            createElement(TextField, { field: control, value: "", onChange: () => {} }),
        }),
        createElement(FormField, {
          key: "address",
          label: "Address",
          children: (control) =>
            createElement(TextField, { field: control, value: "acme", onChange: () => {} }),
        }),
      ],
    }),
    createElement("output", null, String(submits)),
  );
}

test("a headed form is named by its heading and described by its words", () => {
  const container = mount(createElement(Workspace));
  const form = one<HTMLFormElement>(container, "form");
  const heading = one<HTMLHeadingElement>(container, "h2");
  expect(heading.textContent).toBe("Workspace");
  expect(wordsOf(form.getAttribute("aria-labelledby"))).toBe("Workspace");
  expect(wordsOf(form.getAttribute("aria-describedby"))).toBe(
    "How the workspace is shown to its members.",
  );
});

test("a press of the submit button submits the form, and a press of Cancel does not", () => {
  const container = mount(createElement(Workspace));
  act(() => button(container, "Save workspace").click());
  expect(one(container, "output").textContent).toBe("1");
  act(() => button(container, "Cancel").click());
  expect(one(container, "output").textContent).toBe("1");
});

test("the form's error is announced as it arrives and describes the form beside a field's own", () => {
  const container = mount(createElement(Workspace));
  const region = one(container, 'form > [aria-live="polite"]');
  expect(region.textContent).toBe("");
  act(() => button(container, "Save workspace").click());
  expect(one(container, 'form > [aria-live="polite"]')).toBe(region);
  expect(region.textContent).toBe("The workspace could not be saved.");
  const form = one<HTMLFormElement>(container, "form");
  expect(wordsOf(form.getAttribute("aria-describedby"))).toBe(
    "How the workspace is shown to its members. The workspace could not be saved.",
  );
  const [name, address] = [...container.querySelectorAll("input")];
  expect(name?.getAttribute("aria-invalid")).toBe("true");
  expect(wordsOf(name?.getAttribute("aria-describedby") ?? null)).toBe(
    "Give the workspace a name.",
  );
  expect(address?.hasAttribute("aria-invalid")).toBe(false);
});

test("the actions follow the fields, so the keyboard reaches them after the last field", () => {
  const container = mount(createElement(Workspace));
  const address = container.querySelectorAll("input")[1];
  if (address === undefined) throw new Error("no address field");
  for (const name of ["Cancel", "Save workspace"]) {
    const follows = address.compareDocumentPosition(button(container, name));
    expect(follows & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

test("a form with no heading or words is named and described by nothing", () => {
  const container = mount(
    createElement(FormSection, {
      onSubmit: () => {},
      children: createElement(FormField, {
        label: "Name",
        children: (control) =>
          createElement(TextField, { field: control, value: "", onChange: () => {} }),
      }),
    }),
  );
  const form = one<HTMLFormElement>(container, "form");
  expect(container.querySelector("h2")).toBeNull();
  expect(form.hasAttribute("aria-labelledby")).toBe(false);
  expect(form.hasAttribute("aria-describedby")).toBe(false);
});
