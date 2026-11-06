// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { answerOldest, onQueryClient, useMutationAct } from "../../testing/confirm-act.js";
import { holdExits } from "../../testing/held-exits.js";
import { recordedFailure } from "../../testing/reported-failure.js";
import { CONFIRM_LOSS, ConfirmDialog, useConfirmDialog } from "./confirm-dialog.js";

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
});

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
    useMutationAct(() => new Promise<ActionResult>((answer) => answers.push(answer))),
    () => FAILURE,
  );
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: confirm.ask }, "Delete key"),
    createElement("button", { type: "button", onClick: () => setSubject((v) => !v) }, "Key"),
    createElement("button", { type: "button", onClick: () => setSurfaceOpen((v) => !v) }, "Page"),
    createElement(ConfirmDialog, {
      open: true,
      confirm,
      question: {
        title: "Delete the OpenAI key?",
        body: "Vespin stops using it at once.",
        verb: "Delete",
        running: "Deleting",
        loss: CONFIRM_LOSS.IRREVERSIBLE,
      },
      field: withField ? field : undefined,
      gate,
      children: withField
        ? createElement("input", { ref: field, "aria-label": "Type delete" })
        : undefined,
    }),
  );
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

function key(name: string): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true }),
    );
  });
}

function composingEnter(init: KeyboardEventInit): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...init }),
    );
  });
}

function question(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

function refusal(): string | undefined {
  return question()?.querySelector('[data-slot="field-error"]')?.textContent ?? undefined;
}

function holds(element: Element | null | undefined): boolean {
  return element !== null && element !== undefined && document.activeElement === element;
}

function asked(withField = false, gate: string | undefined = undefined) {
  const answers: Answers = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onQueryClient(createElement(Owner, { answers, withField, gate }))));
  const opener = button("Delete key") ?? assert.fail("no opener");
  opener.focus();
  act(() => opener.click());
  assert.ok(question(), "the question is asked");
  const settle = (result: ActionResult) => answerOldest(answers, result);
  return { opener, settle };
}

test("it lands on Cancel, names and describes itself, and Cancel withdraws it and hands focus back", () => {
  const { opener } = asked();
  assert.ok(holds(button("Cancel")), "Cancel takes focus");
  const card = question() ?? assert.fail("no question");
  const title = document.getElementById(card.getAttribute("aria-labelledby") ?? "");
  const body = document.getElementById(card.getAttribute("aria-describedby") ?? "");
  assert.equal(title?.textContent, "Delete the OpenAI key?");
  assert.equal(body?.textContent, "Vespin stops using it at once.");
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

test("an answer that lands holds the card until the check's motion finishes", async () => {
  const motion = new EventTarget();
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement) {
      return this.classList.contains("ui-button-done") ? [motion] : [];
    },
  });
  const { opener, settle } = asked();
  press("Delete");
  await settle(ACCEPTED);
  const card = question();
  const cancelStilled = button("Cancel")?.disabled;
  key("Escape");
  const keptByEscape = question() !== null;
  Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  act(() => motion.dispatchEvent(new Event("finish")));

  assert.ok(card, "the card stands while the check shows");
  assert.equal(cancelStilled, true);
  assert.equal(keptByEscape, true, "Escape does not cut the check short");
  assert.equal(question(), null, "the card goes once the check has been seen");
  assert.ok(holds(opener), "focus goes back to the opener");
});

test("a card whose check has been seen goes once its fade has run", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits(
    (element) =>
      element.classList.contains("ui-button-done") || element.hasAttribute("data-ending-style"),
  );
  const { opener, settle } = asked();
  press("Delete");
  await settle(ACCEPTED);
  act(() => exits.finish());
  const leaving = question();
  act(() => vi.advanceTimersToNextFrame());
  const standsAFrameOn = question() !== null;
  await act(async () => exits.finish());
  exits.restore();
  vi.useRealTimers();

  assert.ok(leaving, "the card stands as it fades");
  assert.equal(standsAFrameOn, true, "the card waits on its fade");
  assert.equal(question(), null, "the card goes once its fade has run");
  assert.ok(holds(opener), "focus goes back to the opener");
});

test("a gated question lands on its gate and offers the act only once the subject's name is typed exactly, a press or Enter before refused", async () => {
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
  type("acme inc");
  key("Enter");
  const runningMisnamed = button("Deleting") !== undefined;
  type("Acme Inc");
  key("Enter");
  const running = button("Deleting")?.disabled;
  await settle(ACCEPTED);

  assert.ok(landed, "the gate takes focus in Cancel's place");
  assert.equal(label, "Type Acme Inc to confirm");
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
