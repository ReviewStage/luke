// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { Dialog } from "../dialog/dialog.js";
import { DialogActions } from "../dialog/dialog-actions.js";
import { CONFIRM_LOSS, FootQuestion, useConfirmDialog } from "./confirm-dialog.js";

/**
 * foot-question.test.ts -- a question asked inside a dialog about something
 * it holds stands at that dialog's foot, never in a card over it: its words
 * and Cancel and the act take the foot's own answers' place, Cancel takes
 * focus, and what the dialog holds stands still. Cancel, Escape, and a press
 * on the dimmed window take the question back and leave the dialog open,
 * focus going back to what asked; an answer under way stills the foot and
 * holds it against Escape; a refusal keeps the question up saying why and
 * shakes the card; and once the act lands the dialog's own answers come back.
 */

/** The answers the owner's act is waiting on, settled by the test in the order they were asked. */
type Answers = ((result: ActionResult) => void)[];

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };
const REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "The key is in use.",
};

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** A key's dialog: the key with Delete key, which asks at the foot, and Done; the key goes once its deletion lands. */
function KeyDialog({ answers, onDone }: { answers: Answers; onDone: () => void }) {
  const [key, setKey] = useState(true);
  const confirm = useConfirmDialog({ subject: key, surfaceOpen: true }, () =>
    new Promise<ActionResult>((answer) => answers.push(answer)).then((result) => {
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) setKey(false);
      return result;
    }),
  );
  return createElement(
    Dialog,
    {
      open: true,
      title: "OpenAI",
      onDismiss: onDone,
      actions: createElement(DialogActions, { onDone }),
    },
    key ? createElement("button", { type: "button", onClick: confirm.ask }, "Delete key") : null,
    createElement(FootQuestion, {
      confirm,
      question: {
        title: "Delete the OpenAI key?",
        body: "Luke stops using it at once.",
        verb: "Delete",
        running: "Deleting",
        loss: CONFIRM_LOSS.IRREVERSIBLE,
      },
    }),
  );
}

/** The button whose accessible name is `name`, wherever it stands. */
function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
}

function press(name: string): void {
  const target = button(name) ?? assert.fail(`no ${name} button`);
  act(() => target.click());
}

/** Presses Escape on whatever holds focus. */
function pressEscape(): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

/** The one card standing. */
function card(): HTMLElement {
  const cards = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  assert.equal(cards.length, 1, "one card stands");
  return cards[0] ?? assert.fail("no card");
}

/** The question at the card's foot, while it stands. */
function question(): HTMLElement | null {
  return card().querySelector<HTMLElement>('[role="group"]');
}

/** Whether `element` holds the keyboard, compared by hand so a failure does not print both elements whole. */
function holds(element: Element | null | undefined): boolean {
  return element !== null && element !== undefined && document.activeElement === element;
}

/** The dialog drawn and its question asked from Delete key, which keeps focus as a press would give it. */
function asked() {
  const answers: Answers = [];
  const onDone = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(KeyDialog, { answers, onDone })));
  const opener = button("Delete key") ?? assert.fail("no opener");
  opener.focus();
  act(() => opener.click());
  const settle = async (result: ActionResult) => {
    const answer = answers.shift() ?? assert.fail("no answer pending");
    await act(async () => answer(result));
  };
  return { opener, onDone, settle };
}

test("it takes the foot's place rather than a card of its own, lands on Cancel, names itself, and stills the dialog's body", () => {
  asked();
  const asking = question() ?? assert.fail("no question at the foot");
  assert.equal(button("Done"), undefined, "the dialog's own answer gives way");
  assert.ok(holds(button("Cancel")), "Cancel takes focus");
  assert.equal(button("Delete")?.getAttribute("data-variant"), "danger");
  const title = document.getElementById(asking.getAttribute("aria-labelledby") ?? "");
  const body = document.getElementById(asking.getAttribute("aria-describedby") ?? "");
  assert.equal(title?.textContent, "Delete the OpenAI key?");
  assert.equal(body?.textContent, "Luke stops using it at once.");
  assert.ok(button("Delete key")?.closest("[inert]"), "what the dialog holds takes no press");
});

test("Tab and Shift-Tab go between the question's two answers, never into the stilled body", () => {
  asked();
  const tab = (shiftKey: boolean) =>
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }),
      );
    });
  tab(true);
  assert.ok(holds(button("Delete")), "Shift-Tab from Cancel wraps to the act");
  tab(false);
  assert.ok(holds(button("Cancel")), "Tab from the act wraps to Cancel");
});

test("Cancel takes the question back, the dialog's answers come back, and focus goes back to what asked", () => {
  const { opener, onDone } = asked();
  press("Cancel");
  assert.equal(question(), null);
  assert.ok(button("Done"));
  assert.equal(button("Delete key")?.closest("[inert]"), null);
  assert.ok(holds(opener), "focus goes back to Delete key");
  assert.equal(onDone.mock.calls.length, 0, "the dialog stays");
});

test("Escape takes the question back rather than the dialog, and a second Escape closes it", () => {
  const { opener, onDone } = asked();
  pressEscape();
  assert.equal(question(), null);
  assert.ok(holds(opener));
  assert.equal(onDone.mock.calls.length, 0, "the dialog stays");
  pressEscape();
  assert.equal(onDone.mock.calls.length, 1);
});

test("an answer under way stills the foot and holds against Escape, and once it lands the dialog's answers come back", async () => {
  const { settle, onDone } = asked();
  press("Delete");
  assert.equal(button("Deleting")?.disabled, true, "the act is named for what it is doing");
  assert.equal(button("Cancel")?.disabled, true);
  assert.ok(holds(card()), "the card holds focus while the buttons are stilled");
  pressEscape();
  assert.ok(question(), "Escape does not withdraw an answer already given");
  assert.equal(onDone.mock.calls.length, 0);
  await settle(ACCEPTED);
  assert.equal(question(), null);
  assert.ok(button("Done"), "the dialog's own answer comes back");
  assert.equal(button("Delete key"), undefined, "the key went");
});

test("a refusal keeps the question at the foot saying why and shakes the card, and the act can be tried again", async () => {
  const { settle } = asked();
  press("Delete");
  await settle(REFUSED);
  const asking = question() ?? assert.fail("the question went");
  assert.equal(
    asking.querySelector('[data-slot="field-error"]')?.textContent,
    "The key is in use.",
  );
  assert.equal(card().getAttribute("data-refused"), "true");
  assert.ok(holds(button("Cancel")), "focus comes back to Cancel");
  press("Delete");
  await settle(ACCEPTED);
  assert.equal(question(), null);
});
