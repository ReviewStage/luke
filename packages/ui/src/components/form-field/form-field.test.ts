// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { TextField } from "../text-field/text-field.js";
import { FormField } from "./form-field.js";

/**
 * form-field.test.ts -- a field that may be left empty says Optional in its
 * label, so its control is named with it, and a field that must be filled
 * says nothing of the kind.
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

/** A subject field, optional or not. */
function subject(optional: boolean | undefined): ReactElement {
  return createElement(FormField, {
    label: "Subject",
    optional,
    children: (field) => createElement(TextField, { field, value: "", onChange: () => undefined }),
  });
}

/** The words of the label that names the field's control, as a reader hears them. */
function controlLabel(container: HTMLElement): string | undefined {
  const input = container.querySelector("input");
  assert.ok(input);
  return [...(input.labels ?? [])].map((label) => label.textContent).join(" ");
}

test("a field that may be left empty says Optional after its label, in the name its control is read by", () => {
  const container = render(subject(true));
  assert.equal(controlLabel(container), "SubjectOptional");
});

test("a field that must be filled says nothing of being optional", () => {
  assert.equal(controlLabel(render(subject(false))), "Subject");
  assert.equal(controlLabel(render(subject(undefined))), "Subject");
});
