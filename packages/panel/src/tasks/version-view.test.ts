// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { ToastHost, type ToastNotice, useToast } from "../toast.js";
import { HISTORY_READ } from "./use-plan-history.js";
import { sayRestored, useVersionRestore, VersionView } from "./version-view.js";

/**
 * version-view.test.ts -- Restore this version restores at once, asking nothing, a refusal said in a toast; and a restored version is said in the window's toast: with an Undo where the history names the version that stood before, which restores that one and says so where it is refused. Synthetic throughout.
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

/** A version of a plan that is not the newest, as the version history draws it, whose restore answers `answer`; each version asked and each restore landed heard. */
function mountVersion(answer: ActionResult, asked: (number | undefined)[], landed: string[]): void {
  function Version(): React.JSX.Element {
    const restore = useVersionRestore(
      {
        onRestore: (seq) => {
          asked.push(seq);
          return Promise.resolve(answer);
        },
      },
      () => landed.push("restored"),
    );
    return createElement(VersionView, {
      onRetry: () => undefined,
      viewing: {
        line: {
          seq: 2,
          lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: 2, duringCall: false },
          startedAt: 1,
          changes: 1,
        },
        current: false,
        read: {
          kind: HISTORY_READ.READY,
          document: { body: "## Plan\n\nShip it.", assumptions: [] },
          previous: null,
        },
      },
      restore,
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  registry = AtomRegistry.make();
  const held = registry;
  act(() =>
    root?.render(
      onRegistry(
        held,
        createElement(Fragment, null, createElement(Version), createElement(ToastHost)),
      ),
    ),
  );
}

/** Restore this version's button. */
function restoreButton(): HTMLButtonElement {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Restore this version",
    ) ?? assert.fail("no Restore this version")
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

test("Restore this version restores the version at once, asking nothing", async () => {
  const asked: (number | undefined)[] = [];
  const landed: string[] = [];
  mountVersion({ status: ACTION_RESULT_STATUS.ACCEPTED }, asked, landed);

  await act(async () => restoreButton().click());

  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing is asked");
  assert.deepEqual(asked, [undefined]);
  assert.deepEqual(landed, ["restored"]);
});

test("a restore the service refuses says why in a toast and leaves the version where it stands", async () => {
  const landed: string[] = [];
  mountVersion(
    {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "The version could not be restored. Try again.",
    },
    [],
    landed,
  );

  await act(async () => restoreButton().click());

  assert.deepEqual(landed, []);
  assert.deepEqual(standing(), ["The version could not be restored. Try again."]);
});
