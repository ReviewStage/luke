// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { Dialog } from "./dialog.js";
import { DIALOG_TONE, DialogActions } from "./dialog-actions.js";

/**
 * dialog-actions.test.ts -- a dialog's foot draws Cancel and then the act,
 * Cancel stilled with the act while it runs, and a dialog that only shows
 * draws Done alone, which puts it away.
 */

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

/** Draws `element` into the page. */
function draw(element: React.ReactElement): void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

/** The card's foot's answers, by what each says, in order. */
function answers(): string[] {
  const card = document.querySelector('[role="dialog"]') ?? assert.fail("no dialog");
  const body = card.querySelector('[data-slot="dialog-body"]');
  return [...card.querySelectorAll("button")]
    .filter((each) => !body?.contains(each))
    .map((each) => each.getAttribute("aria-label") ?? each.textContent ?? "");
}

/** The button that says `name`. */
function button(name: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll("button")].find(
      (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
    ) ?? assert.fail(`no ${name} button`)
  );
}

/** A dialog that asks to archive a channel, its act running once pressed. */
function Asking(): React.JSX.Element {
  const [running, setRunning] = useState(false);
  return createElement(Dialog, {
    title: "Archive #design?",
    onDismiss: () => undefined,
    actions: createElement(DialogActions, {
      onCancel: () => undefined,
      act: {
        verb: "Archive",
        tone: DIALOG_TONE.PRIMARY,
        running: "Archiving",
        busy: running,
        onPress: () => setRunning(true),
      },
    }),
    children: "Everyone in it stops seeing it.",
  });
}

/** A dialog that only shows a result, put away by its Done. */
function Showing(): React.JSX.Element | null {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return createElement(Dialog, {
    title: "Webhook secret",
    onDismiss: () => setOpen(false),
    actions: createElement(DialogActions, { onDone: () => setOpen(false) }),
    children: "Copy it now. It is not shown again.",
  });
}

test("Cancel comes first and the act last, and Cancel is stilled while the act runs", () => {
  draw(createElement(Asking));
  assert.deepEqual(answers(), ["Cancel", "Archive"]);
  assert.equal(button("Cancel").disabled, false);
  act(() => button("Archive").click());
  assert.equal(button("Cancel").disabled, true);
  assert.equal(button("Archiving").disabled, true, "the act names what it is doing");
});

test("a dialog that only shows has Done alone, which puts it away", () => {
  draw(createElement(Showing));
  assert.deepEqual(answers(), ["Done"]);
  act(() => button("Done").click());
  assert.equal(document.querySelector('[role="dialog"]'), null);
});
