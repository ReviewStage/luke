// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { answerOldest, onQueryClient, useMutationAct } from "../../testing/confirm-act.js";
import { recordedFailure } from "../../testing/reported-failure.js";
import { Dialog } from "../dialog/dialog.js";
import { DialogActions } from "../dialog/dialog-actions.js";
import { CONFIRM_LOSS, FootQuestion, useConfirmDialog } from "./confirm-dialog.js";

const { failure: FAILURE } = recordedFailure();

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

function KeyDialog({ answers, onDone }: { answers: Answers; onDone: () => void }) {
  const [key, setKey] = useState(true);
  const confirm = useConfirmDialog(
    { subject: key, surfaceOpen: true },
    useMutationAct(() =>
      new Promise<ActionResult>((answer) => answers.push(answer)).then((result) => {
        if (result.status === ACTION_RESULT_STATUS.ACCEPTED) setKey(false);
        return result;
      }),
    ),
    () => FAILURE,
  );
  return createElement(Dialog, {
    open: true,
    title: "OpenAI",
    onDismiss: onDone,
    actions: createElement(DialogActions, { onDone }),
    children: [
      key
        ? createElement(
            "button",
            { key: "key", type: "button", onClick: confirm.ask },
            "Delete key",
          )
        : null,
      createElement(FootQuestion, {
        key: "question",
        confirm,
        question: {
          title: "Delete the OpenAI key?",
          body: "Vespin stops using it at once.",
          verb: "Delete",
          running: "Deleting",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        },
      }),
    ],
  });
}

function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
}

function press(name: string): void {
  const target = button(name) ?? assert.fail(`no ${name} button`);
  act(() => target.click());
}

function pressEscape(): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

function card(): HTMLElement {
  const cards = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  assert.equal(cards.length, 1, "one card stands");
  return cards[0] ?? assert.fail("no card");
}

function question(): HTMLElement | null {
  return card().querySelector<HTMLElement>('[role="group"]');
}

function holds(element: Element | null | undefined): boolean {
  return element !== null && element !== undefined && document.activeElement === element;
}

function asked() {
  const answers: Answers = [];
  const onDone = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onQueryClient(createElement(KeyDialog, { answers, onDone }))));
  const opener = button("Delete key") ?? assert.fail("no opener");
  opener.focus();
  act(() => opener.click());
  const settle = (result: ActionResult) => answerOldest(answers, result);
  return { opener, onDone, settle };
}

test("it takes the foot's place rather than a card of its own, lands on Cancel, names itself, and stills the dialog's body", () => {
  asked();
  const asking = question() ?? assert.fail("no question at the foot");
  assert.equal(button("Done"), undefined, "the dialog's own answer gives way");
  assert.ok(holds(button("Cancel")), "Cancel takes focus");
  const title = document.getElementById(asking.getAttribute("aria-labelledby") ?? "");
  const body = document.getElementById(asking.getAttribute("aria-describedby") ?? "");
  assert.equal(title?.textContent, "Delete the OpenAI key?");
  assert.equal(body?.textContent, "Vespin stops using it at once.");
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

test("a refusal keeps the question at the foot saying why, and the act can be tried again", async () => {
  const { settle } = asked();
  press("Delete");
  await settle(REFUSED);
  const asking = question() ?? assert.fail("the question went");
  assert.equal(
    asking.querySelector('[data-slot="field-error"]')?.textContent,
    "The key is in use.",
  );
  assert.ok(holds(button("Cancel")), "focus comes back to Cancel");
  press("Delete");
  await settle(ACCEPTED);
  assert.equal(question(), null);
});
