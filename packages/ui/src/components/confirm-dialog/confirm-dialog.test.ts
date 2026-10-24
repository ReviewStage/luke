// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { DIALOG_TONE } from "../dialog/dialog-actions.js";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  useConfirmDialog,
} from "./confirm-dialog.js";

/**
 * confirm-dialog.test.ts -- a question opened from a button lands on
 * Cancel, or on its field where it asks one; Cancel and Escape withdraw it
 * and hand focus back; an answer under way stills both buttons and holds
 * the card until it lands; a refusal keeps the card up saying why, and the
 * act can be tried again; and the question goes the moment its subject or
 * its surface does, a refusal with it, while an answer already given
 * finishes unseen. An answer that lands shows its check in the act's place
 * until the check has been seen; a refusal shakes the card; and a gated
 * question offers its act only once the subject's name is typed exactly.
 * Only an act past undoing is drawn red; one that can be undone but reaches
 * someone else asks in the accent, whatever tone it also names.
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
});

/** A settings line that asks before deleting a key, with toggles that take the key or the page away. */
function Owner({
  answers,
  withField,
  gate,
}: {
  answers: Answers;
  withField: boolean;
  gate: string | undefined;
}) {
  const [subject, setSubject] = useState(true);
  const [surfaceOpen, setSurfaceOpen] = useState(true);
  const field = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirmDialog(
    { subject, surfaceOpen },
    () => new Promise<ActionResult>((answer) => answers.push(answer)),
  );
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: confirm.ask }, "Delete key"),
    createElement("button", { type: "button", onClick: () => setSubject((v) => !v) }, "Key"),
    createElement("button", { type: "button", onClick: () => setSurfaceOpen((v) => !v) }, "Page"),
    createElement(ConfirmDialog, {
      confirm,
      question: {
        title: "Delete the OpenAI key?",
        body: "Luke stops using it at once.",
        verb: "Delete",
        running: "Deleting",
      },
      field: withField ? field : undefined,
      gate,
      children: withField
        ? createElement("input", { ref: field, "aria-label": "Type delete" })
        : undefined,
    }),
  );
}

/** The button whose accessible name is `name`, wherever it stands. */
function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
}

/** Presses `name`, failing if no such button stands. */
function press(name: string): void {
  const target = button(name) ?? assert.fail(`no ${name} button`);
  act(() => target.click());
}

/** Presses `key` on whatever holds focus. */
function key(name: string): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true }),
    );
  });
}

/** Presses Enter as an input method does to confirm a composition, on whatever holds focus: flagged composing, and for Safari's last key, code 229 alone. */
function composingEnter(init: KeyboardEventInit): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...init }),
    );
  });
}

/** The question's card, while it stands. */
function question(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

/** What the card's error line says, which is nothing while the act was not refused. */
function refusal(): string | undefined {
  return question()?.querySelector('[data-slot="field-error"]')?.textContent ?? undefined;
}

/**
 * Whether `element` holds the keyboard. Note that a focus is compared by
 * hand, because a failed `assert.equal` prints both elements whole.
 */
function holds(element: Element | null | undefined): boolean {
  return element !== null && element !== undefined && document.activeElement === element;
}

/** The owner drawn and its question asked from its button, which keeps focus as a press would give it. */
function asked(withField = false, gate: string | undefined = undefined) {
  const answers: Answers = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Owner, { answers, withField, gate })));
  const opener = button("Delete key") ?? assert.fail("no opener");
  opener.focus();
  act(() => opener.click());
  assert.ok(question(), "the question is asked");
  const settle = async (result: ActionResult) => {
    const answer = answers.shift() ?? assert.fail("no answer pending");
    await act(async () => answer(result));
  };
  return { opener, settle };
}

test("it lands on Cancel, names and describes itself, and Cancel withdraws it and hands focus back", () => {
  const { opener } = asked();
  assert.ok(holds(button("Cancel")), "Cancel takes focus");
  const card = question() ?? assert.fail("no question");
  const title = document.getElementById(card.getAttribute("aria-labelledby") ?? "");
  const body = document.getElementById(card.getAttribute("aria-describedby") ?? "");
  assert.equal(title?.textContent, "Delete the OpenAI key?");
  assert.equal(body?.textContent, "Luke stops using it at once.");
  press("Cancel");
  assert.equal(question(), null);
  assert.ok(holds(opener), "focus goes back to the opener");
});

test("an answer under way stills both buttons and holds the card, and its landing puts the card away", async () => {
  const { opener, settle } = asked();
  press("Delete");
  assert.equal(button("Deleting")?.disabled, true, "the act is named for what it is doing");
  assert.equal(button("Cancel")?.disabled, true);
  assert.ok(holds(question()), "the card holds focus while the buttons are stilled");
  key("Escape");
  assert.ok(question(), "Escape does not withdraw an answer already given");
  await settle(ACCEPTED);
  assert.equal(question(), null);
  assert.ok(holds(opener), "focus goes back to the opener");
});

test("a refusal keeps the card up saying why, and the act can be tried again", async () => {
  const { settle } = asked();
  press("Delete");
  await settle(REFUSED);
  assert.equal(refusal(), "The key is in use.");
  assert.ok(holds(button("Cancel")), "focus comes back to Cancel");
  press("Delete");
  assert.equal(refusal(), "", "a fresh try clears the refusal");
  await settle(ACCEPTED);
  assert.equal(question(), null);
});

test("Escape withdraws a question still asked", () => {
  const { opener } = asked();
  key("Escape");
  assert.equal(question(), null);
  assert.ok(holds(opener));
});

test("the question goes the moment its subject does, and focus goes back to what asked", () => {
  const { opener } = asked();
  press("Key");
  assert.equal(question(), null);
  assert.ok(holds(opener), "focus goes back to the opener");
  press("Key");
  assert.equal(question(), null, "the subject coming back does not ask again");
});

test("a refusal goes with its surface and is not drawn again when the surface comes back", async () => {
  const { settle } = asked();
  press("Delete");
  await settle(REFUSED);
  assert.equal(refusal(), "The key is in use.");
  press("Page");
  assert.equal(question(), null);
  press("Page");
  assert.equal(question(), null);
});

test("an answer already given finishes unseen when its surface goes, and is not drawn again", async () => {
  const { settle } = asked();
  press("Delete");
  press("Page");
  assert.equal(question(), null, "the card goes with its surface while the answer runs");
  await settle(REFUSED);
  press("Page");
  assert.equal(
    question(),
    null,
    "the refusal that landed unseen is not drawn when the surface returns",
  );
});

test("a question that asks for a field lands on it, and Enter there answers", async () => {
  const { settle } = asked(true);
  const field = document.querySelector('input[aria-label="Type delete"]');
  assert.ok(holds(field), "the field takes focus in Cancel's place");
  key("Enter");
  assert.equal(button("Deleting")?.disabled, true, "Enter in the field answers");
  await settle(ACCEPTED);
  assert.equal(question(), null);
});

test("an answer that lands shows its check in the act's place, the card standing until the check's motion finishes", async () => {
  const motion = new EventTarget();
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement) {
      return this.classList.contains("luke-button-done") ? [motion] : [];
    },
  });
  const { opener, settle } = asked();
  press("Delete");
  await settle(ACCEPTED);
  const card = question();
  const checked = button("Delete")?.getAttribute("data-done");
  const cancelStilled = button("Cancel")?.disabled;
  key("Escape");
  const keptByEscape = question() !== null;
  act(() => motion.dispatchEvent(new Event("finish")));
  Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");

  assert.ok(card, "the card stands while the check shows");
  assert.equal(checked, "true", "the act wears its check");
  assert.equal(cancelStilled, true);
  assert.equal(keptByEscape, true, "Escape does not cut the check short");
  assert.equal(question(), null, "the card goes once the check has been seen");
  assert.ok(holds(opener), "focus goes back to the opener");
});

test("a refusal shakes the card as it lands", async () => {
  const { settle } = asked();
  press("Delete");
  await settle(REFUSED);
  assert.equal(question()?.getAttribute("data-refused"), "true");
});

test("a gated question lands on its gate and offers the act only once the subject's name is typed exactly, a press or Enter before refused with a shake", async () => {
  const { settle } = asked(false, "Acme Inc");
  const gate = question()?.querySelector("input") ?? assert.fail("no gate");
  const type = (words: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(gate, words);
      gate.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const landed = holds(gate);
  const label = document.querySelector(`label[for="${gate.id}"]`)?.textContent;
  press("Delete");
  const refusedPress = button("Delete")?.getAttribute("data-denied");
  type("acme inc");
  key("Enter");
  const runningMisnamed = button("Deleting") !== undefined;
  type("Acme Inc");
  key("Enter");
  const running = button("Deleting")?.disabled;
  await settle(ACCEPTED);

  assert.ok(landed, "the gate takes focus in Cancel's place");
  assert.equal(label, "Type Acme Inc to confirm");
  assert.equal(refusedPress, "true", "a press before the name shakes the act");
  assert.equal(runningMisnamed, false, "a name typed otherwise is not the name");
  assert.equal(running, true, "Enter answers once the name is typed");
  assert.equal(question(), null);
});

test("an Enter that confirms an input method's composition does not answer a field's or a gate's question", async () => {
  const { settle } = asked(false, "Acme Inc");
  const gate = question()?.querySelector("input") ?? assert.fail("no gate");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      gate,
      "Acme Inc",
    );
    gate.dispatchEvent(new Event("input", { bubbles: true }));
  });
  composingEnter({ isComposing: true });
  composingEnter({ keyCode: 229 });
  const runningAfterComposing = button("Deleting") !== undefined;
  key("Enter");
  const running = button("Deleting")?.disabled;
  await settle(ACCEPTED);

  assert.equal(runningAfterComposing, false, "a composing Enter does not press the act");
  assert.equal(running, true, "the Enter after the composition answers");
});

/** A question asked with `costs` on its act, already open, and the look its act is drawn in. */
function actLook(costs: Pick<DialogQuestion, "loss" | "tone">): string | null {
  function Asked() {
    const confirm = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
      Promise.resolve(ACCEPTED),
    );
    const [asked, setAsked] = useState(false);
    if (!asked) {
      setAsked(true);
      confirm.ask();
    }
    return createElement(ConfirmDialog, {
      confirm,
      question: { title: "Remove Ada?", verb: "Remove", running: "Removing", ...costs },
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Asked)));
  const look = button("Remove")?.getAttribute("data-variant") ?? null;
  act(() => root.unmount());
  roots.splice(roots.indexOf(root), 1);
  return look;
}

test("only an act past undoing is drawn red; one that reaches someone else asks in the accent", () => {
  assert.equal(actLook({ loss: CONFIRM_LOSS.IRREVERSIBLE }), "danger");
  assert.equal(actLook({ loss: CONFIRM_LOSS.AFFECTS_OTHERS }), "primary");
  assert.equal(
    actLook({ loss: CONFIRM_LOSS.AFFECTS_OTHERS, tone: DIALOG_TONE.DANGER }),
    "primary",
    "the loss decides over a tone",
  );
  assert.equal(actLook({}), "danger", "a question naming no loss keeps today's red");
});
