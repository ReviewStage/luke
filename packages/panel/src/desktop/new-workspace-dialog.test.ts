// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type NewWorkspaceAsk, useNewWorkspaceDialog } from "./new-workspace-dialog.js";

/**
 * new-workspace-dialog.test.ts -- New workspace is a form, not a confirm: a
 * dialog whose one field is labelled, whose Create workspace waits on a name,
 * and which Enter submits and Escape cancels.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The prompt drawn over a window that creates into `created`, and the press that opens it. */
function mounted(created: string[]): () => void {
  let latest: NewWorkspaceAsk | undefined;
  function Prompt() {
    latest = useNewWorkspaceDialog(
      (name) => {
        created.push(name);
        return Promise.resolve(undefined);
      },
      { signedIn: true, surfaceOpen: true },
    );
    return createElement(Fragment, null, latest.dialog);
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Prompt)));
  const ask = latest;
  assert.ok(ask, "the prompt is drawn");
  return () => act(() => ask.ask());
}

const card = () => document.querySelector('[role="dialog"], [role="alertdialog"]');
const field = () => card()?.querySelector<HTMLInputElement>("input");
const create = () =>
  [...(card()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => button.textContent === "Create workspace",
  );

/** Types `words` into the field as a person does. */
function type(input: HTMLInputElement, words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Presses `key` in the element. */
function press(element: Element, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

test("New workspace is a labelled form whose Create waits on a name, and Enter submits it", async () => {
  const created: string[] = [];
  mounted(created)();
  assert.equal(card()?.getAttribute("role"), "dialog", "a form is a dialog, not an alert");
  const input = field();
  assert.ok(input, "the name field stands");
  assert.equal(input.getAttribute("aria-label"), "Workspace name", "the field is labelled");
  assert.equal(document.activeElement, input, "focus lands in the field, not on Cancel");
  assert.equal(create()?.disabled, true, "Create waits on a name");

  press(input, "Enter");
  assert.deepEqual(created, [], "Enter asks nothing of a blank form");

  type(input, "  Northwind ");
  assert.equal(create()?.disabled, false, "a name frees Create");
  await act(async () => {
    press(input, "Enter");
  });
  assert.deepEqual(created, ["Northwind"], "Enter creates with the name trimmed");
});

test("Escape cancels a form without creating", () => {
  const created: string[] = [];
  mounted(created)();
  const input = field();
  assert.ok(input);
  type(input, "Northwind");
  press(input, "Escape");
  assert.equal(card(), null, "Escape puts the card away");
  assert.deepEqual(created, []);
});
