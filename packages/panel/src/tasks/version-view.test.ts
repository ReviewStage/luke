// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { ToastHost, type ToastNotice, useToast } from "../toast.js";
import { sayRestored } from "./version-view.js";

/**
 * version-view.test.ts -- a restored version is said in the window's toast: with an Undo where the history names the version that stood before, which restores that one and says so where it is refused. Synthetic throughout.
 */

let root: Root | undefined;
let registry: AtomRegistry.AtomRegistry | undefined;
let show: ((notice: ToastNotice) => void) | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  registry?.dispose();
  document.body.innerHTML = "";
});

/** Hands the test the window's way of showing a toast. */
function Shower(): null {
  show = useToast();
  return null;
}

/** The window's toasts, mounted as its root mounts them. */
function mount(): void {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  registry = AtomRegistry.make();
  const held = registry;
  act(() =>
    root?.render(
      onRegistry(
        held,
        createElement(Fragment, null, createElement(Shower), createElement(ToastHost)),
      ),
    ),
  );
}

/** What each toast standing says, leaving out those on their way out. */
function standing(): string[] {
  return [...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

/** The Undo on the toasts, or nothing where none stands. */
function undoButton(): HTMLButtonElement | undefined {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(".luke-toast:not([data-leaving]) button"),
  ].find((button) => button.textContent === "Undo");
}

test("a restore with a version before it says so with an Undo, which restores that version and sends the toast away", async () => {
  mount();
  const undone: string[] = [];
  const toast = show ?? assert.fail("the window shows toasts");
  act(() =>
    sayRestored(toast, () => {
      undone.push("restored the version before");
      return Promise.resolve(true);
    }),
  );
  assert.ok(undoButton(), "the restore offers its Undo");

  await act(async () => undoButton()?.click());

  assert.deepEqual(undone, ["restored the version before"]);
  assert.equal(undoButton(), undefined);
  assert.deepEqual(standing(), []);
});

test("an Undo that is refused says the restore could not be undone", async () => {
  mount();
  const toast = show ?? assert.fail("the window shows toasts");
  act(() => sayRestored(toast, () => Promise.resolve(false)));

  await act(async () => undoButton()?.click());

  assert.deepEqual(standing(), ["The restore could not be undone. Try again."]);
});

test("a restore with no version before it says so without an Undo", () => {
  mount();
  const toast = show ?? assert.fail("the window shows toasts");
  act(() => sayRestored(toast, undefined));

  assert.deepEqual(standing(), ["Version restored"]);
  assert.equal(undoButton(), undefined);
});
