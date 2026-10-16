import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { createElement, useRef, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog.js";

/**
 * confirm-dialog.browser.test.ts -- a question opened from a button lands
 * on Cancel, or on its field where it asks one; Cancel and Escape withdraw
 * it and hand focus back; an answer under way stills both buttons and holds
 * the card until it lands; a refusal keeps the card up saying why, and the
 * act can be tried again; and the question goes the moment its subject or
 * its surface does, a refusal with it, while an answer already given
 * finishes unseen.
 */

/** The answers the owner's act is waiting on, settled by the test in the order they were asked. */
type Answers = ((result: ActionResult) => void)[];

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };
const REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "The key is in use.",
};

/** A settings line that asks before deleting a key, with toggles that take the key or the page away. */
function Owner({ answers, withField }: { answers: Answers; withField: boolean }) {
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
    createElement("output", { "aria-label": "Stage" }, confirm.stage),
    createElement(ConfirmDialog, {
      confirm,
      question: {
        title: "Delete the OpenAI key?",
        body: "Luke stops using it at once.",
        verb: "Delete",
        running: "Deleting",
      },
      field: withField ? field : undefined,
      children: withField
        ? createElement("input", { ref: field, "aria-label": "Type delete" })
        : undefined,
    }),
  );
}

/** Presses a control behind the card without the pointer, as the window changing under it would. */
function behind(name: string): void {
  page
    .getByRole("button", { name, exact: true })
    .element()
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The owner drawn and its question asked from its button. */
async function asked(withField = false) {
  const answers: Answers = [];
  await mount(createElement(Owner, { answers, withField }));
  const opener = page.getByRole("button", { name: "Delete key" });
  await opener.click();
  const question = page.getByRole("alertdialog", { name: "Delete the OpenAI key?" });
  await expect.element(question).toBeInTheDocument();
  const cancel = page.getByRole("button", { name: "Cancel" });
  const settle = (result: ActionResult) => (answers.shift() ?? expect.fail("no answer"))(result);
  return { opener, question, cancel, settle };
}

test("it lands on Cancel, says what goes, and Cancel withdraws it and hands focus back", async () => {
  const { opener, question, cancel } = await asked();
  await expect.element(cancel).toHaveFocus();
  await expect.element(question).toHaveAccessibleDescription("Luke stops using it at once.");
  expect(await accessibilityViolations(question.element())).toEqual([]);
  await cancel.click();
  await expect.element(question).not.toBeInTheDocument();
  await expect.element(opener).toHaveFocus();
});

test("an answer under way stills both buttons and holds the card, and its landing puts the card away", async () => {
  const { opener, question, cancel, settle } = await asked();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const running = page.getByRole("button", { name: "Deleting" });
  await expect.element(running).toBeDisabled();
  await expect.element(cancel).toBeDisabled();
  await expect.element(question).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(question).toBeInTheDocument();
  settle(ACCEPTED);
  await expect.element(question).not.toBeInTheDocument();
  await expect.element(opener).toHaveFocus();
});

test("a refusal keeps the card up saying why, and the act can be tried again", async () => {
  const { question, settle } = await asked();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  settle(REFUSED);
  await expect.element(page.getByRole("alert")).toHaveTextContent("The key is in use.");
  await expect.element(page.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  settle(ACCEPTED);
  await expect.element(question).not.toBeInTheDocument();
});

test("the question goes the moment its subject does, and focus goes back to what asked", async () => {
  const { opener, question } = await asked();
  behind("Key");
  await expect.element(question).not.toBeInTheDocument();
  await expect.element(opener).toHaveFocus();
  behind("Key");
  await expect.element(question).not.toBeInTheDocument();
});

test("a refusal goes with its surface and is not drawn again when the surface comes back", async () => {
  const { question, settle } = await asked();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  settle(REFUSED);
  await expect.element(page.getByRole("alert")).toBeInTheDocument();
  behind("Page");
  await expect.element(question).not.toBeInTheDocument();
  behind("Page");
  await expect.element(question).not.toBeInTheDocument();
});

test("an answer already given finishes unseen when its surface goes, and is not drawn again", async () => {
  const { question, settle } = await asked();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  behind("Page");
  await expect.element(question).not.toBeInTheDocument();
  settle(REFUSED);
  await expect.element(page.getByRole("status", { name: "Stage" })).toHaveTextContent("resting");
  behind("Page");
  await expect.element(question).not.toBeInTheDocument();
});

test("a question that asks for a field lands on it, and Enter there answers", async () => {
  const { question, settle } = await asked(true);
  await expect.element(page.getByRole("textbox", { name: "Type delete" })).toHaveFocus();
  await userEvent.keyboard("delete{Enter}");
  await expect.element(page.getByRole("button", { name: "Deleting" })).toBeDisabled();
  settle(ACCEPTED);
  await expect.element(question).not.toBeInTheDocument();
});
