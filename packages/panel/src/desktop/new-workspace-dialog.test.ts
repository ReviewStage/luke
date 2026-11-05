// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { stubCanvas, webpBytes } from "../testing/photo-canvas.js";
import { type NewWorkspaceAsk, useNewWorkspaceDialog } from "./new-workspace-dialog.js";

/**
 * new-workspace-dialog.test.ts -- New workspace is a form, not a confirm: a
 * dialog whose name field is labeled, whose Create workspace waits on a name,
 * which Enter submits and Escape cancels, and which hands a photo picked
 * above the name to the workspace made.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The prompt drawn over a window that creates into `created`, each photo into `photos`, and the press that opens it. */
function mounted(created: string[], photos: (string | undefined)[] = []): () => void {
  let latest: NewWorkspaceAsk | undefined;
  function Prompt() {
    latest = useNewWorkspaceDialog(
      (name, photo) => {
        created.push(name);
        photos.push(photo);
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
const field = () => card()?.querySelector<HTMLInputElement>('input:not([type="file"])');
const label = () => card()?.querySelector("label");
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

test("New workspace is a labeled form whose Create waits on a name, and Enter submits it", async () => {
  const created: string[] = [];
  mounted(created)();
  assert.equal(card()?.getAttribute("role"), "dialog", "a form is a dialog, not an alert");
  const input = field();
  assert.ok(input, "the name field stands");
  assert.equal(label()?.textContent, "Workspace name", "a visible label stands above the field");
  assert.equal(label()?.htmlFor, input.id, "the label names the field");
  assert.equal(input.getAttribute("aria-label"), null, "the field is named by its label alone");
  assert.notEqual(input.placeholder, "Workspace name", "the placeholder is not the label again");
  assert.equal(document.activeElement, input, "focus lands in the field, not on Cancel");
  assert.equal(create()?.disabled, true, "Create waits on a name");

  await act(async () => {
    press(input, "Enter");
  });
  assert.deepEqual(created, [], "Enter creates nothing from a blank form");

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

test("Enter on a blank name marks the field invalid and says why on it, and typing takes it away", async () => {
  const created: string[] = [];
  mounted(created)();
  const input = field();
  assert.ok(input);
  assert.equal(input.getAttribute("aria-invalid"), null, "a fresh form is not marked");

  await act(async () => {
    press(input, "Enter");
  });
  const error = input.closest('[data-slot="field"]')?.querySelector('[data-slot="field-error"]');
  assert.equal(input.getAttribute("aria-invalid"), "true", "the field is marked invalid");
  assert.equal(error?.textContent, "Name the workspace.");
  assert.ok(
    input
      .getAttribute("aria-describedby")
      ?.split(" ")
      .includes(error?.id ?? "missing"),
    "the error describes the field",
  );
  assert.deepEqual(created, [], "nothing is created from a blank name");

  type(input, "N");
  assert.equal(input.getAttribute("aria-invalid"), null, "typing clears the mark");
});

test("a photo picked above the name is handed on with it when the workspace is made", async () => {
  const webp = webpBytes();
  stubCanvas(300, 300, webp);
  const created: string[] = [];
  const photos: (string | undefined)[] = [];
  mounted(created, photos)();
  const picker = card()?.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(picker, "the photo's picker stands in the card");
  Object.defineProperty(picker, "files", {
    configurable: true,
    value: [new File([new Uint8Array([1, 2, 3])], "paperstar.png", { type: "image/png" })],
  });
  act(() => {
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // Note that the encoder's file read lands on a later turn, as jsdom answers it.
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
  const input = field();
  assert.ok(input);
  type(input, "Paperstar");
  await act(async () => {
    press(input, "Enter");
  });
  assert.deepEqual(created, ["Paperstar"]);
  assert.deepEqual(photos, [`data:image/webp;base64,${btoa(String.fromCharCode(...webp))}`]);
});
