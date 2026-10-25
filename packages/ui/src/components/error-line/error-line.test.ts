// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Announcer } from "../announcer/announcer.js";
import { FormField } from "../form-field/form-field.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import { TextField } from "../text-field/text-field.js";

/**
 * error-line.test.ts -- what went wrong is said in one line wherever it is
 * said: a form field's error and a Settings row's each describe the control
 * it is about, and are said through the window's
 * announcer as it arrives: a form field's politely, a Settings row's as an
 * alert.
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

const REFUSED = "GitHub refused the token.";

/** A text field in a form field saying `error`. */
function formField(error: string | undefined): ReactElement {
  return createElement(FormField, {
    label: "Token",
    error,
    children: (field) => createElement(TextField, { field, value: "", onChange: () => undefined }),
  });
}

/** A text field in a Settings row saying `error`. */
function settingsRow(error: string | undefined): ReactElement {
  return createElement(SettingsRow, {
    label: "Token",
    error,
    children: (control) =>
      createElement(TextField, {
        label: "Token",
        describedBy: control["aria-describedby"],
        value: "",
        onChange: () => undefined,
      }),
  });
}

/** Fails unless the control's description names its error line. */
function describedByErrorLine(container: HTMLElement): void {
  const input = container.querySelector("input");
  assert.ok(input);
  const ids = (input.getAttribute("aria-describedby") ?? "").split(" ");
  const line = ids
    .map((id) => document.getElementById(id))
    .find((element) => element?.dataset.slot === "field-error");
  assert.ok(line, "the control is described by its error line");
}

test("a form field's error and a Settings row's each describe their control", () => {
  describedByErrorLine(render(formField(REFUSED)));
  describedByErrorLine(render(settingsRow(REFUSED)));
});

/** What the window's polite and alert regions say once `place` goes from no error to `REFUSED`. */
function saidOnArrival(place: (error: string | undefined) => ReactElement): {
  polite: string | null | undefined;
  alert: string | null | undefined;
} {
  render(createElement(Announcer));
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(place(undefined)));
  act(() => root.render(place(REFUSED)));
  return {
    polite: document.querySelector('[role="status"]')?.textContent,
    alert: document.querySelector('[role="alert"]')?.textContent,
  };
}

test("a form field's error is said politely as it arrives", () => {
  assert.deepEqual(saidOnArrival(formField), { polite: REFUSED, alert: "" });
});

test("a Settings row's refused write is said as an alert as it arrives", () => {
  assert.deepEqual(saidOnArrival(settingsRow), { polite: "", alert: REFUSED });
});
