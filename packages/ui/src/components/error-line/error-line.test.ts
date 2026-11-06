// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { recordedFailure } from "../../testing/reported-failure.js";
import { Announcer } from "../announcer/announcer.js";
import { FormField } from "../form-field/form-field.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import { TextField } from "../text-field/text-field.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
});

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

const REFUSED = "GitHub refused the token.";

const { failure: FAILURE } = recordedFailure();

function formField(error: string | undefined): ReactElement {
  return createElement(FormField, {
    label: "Token",
    error: error === undefined ? undefined : { words: error, failure: FAILURE },
    children: (field) => createElement(TextField, { field, value: "", onChange: () => undefined }),
  });
}

function settingsRow(error: string | undefined): ReactElement {
  return createElement(SettingsRow, {
    label: "Token",
    error: error === undefined ? undefined : { words: error, failure: FAILURE },
    children: (control) =>
      createElement(TextField, {
        label: "Token",
        describedBy: control["aria-describedby"],
        value: "",
        onChange: () => undefined,
      }),
  });
}

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

test("once nothing is wrong, the last words stay out of reach through their fade, and go once it has played", () => {
  const fade = new EventTarget();
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement) {
      return this.dataset.leaving === "true" ? [fade] : [];
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(formField(REFUSED)));
  const line = container.querySelector<HTMLElement>('[data-slot="field-error"]');

  act(() => root.render(formField(undefined)));

  assert.equal(line?.textContent, REFUSED, "the words fade rather than going at once");
  assert.equal(line?.hasAttribute("inert"), true);
  act(() => {
    fade.dispatchEvent(new Event("finish"));
  });
  assert.equal(line?.textContent, "");
});
