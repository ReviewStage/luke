import { createElement, Fragment, useId, useRef, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { CompatDialog } from "../../compat.js";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { DIALOG_ROLE, Dialog } from "./dialog.js";

/**
 * dialog.browser.test.ts -- a dialog opened from a button takes the
 * keyboard and keeps Tab among its own controls; Escape, a press on the
 * dimmed window, or its owner taking it away puts it away and hands focus
 * back to the button; a press dragged out of the card puts nothing away; an
 * input method's keys stay the method's; no key or press inside reaches the
 * window behind; a busy dialog holds focus on its card until it is done; and
 * the compatibility twin is the same dialog with its caller's class.
 */

/** What the window behind the dialog heard, which should be nothing. */
interface Heard {
  keys: string[];
  presses: number;
  dialogKeys: string[];
}

/** A window holding the button that opens a dialog with a field and two answers, and a toggle that withdraws it. */
function Owner({ heard, busy = false }: { heard: Heard; busy?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(true);
  const field = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  return createElement(
    "div",
    {
      onKeyDown: (event: React.KeyboardEvent) => heard.keys.push(event.key),
      onClick: () => {
        heard.presses += 1;
      },
    },
    createElement("button", { type: "button", onClick: () => setOpen(true) }, "Rename"),
    createElement("button", { type: "button", onClick: () => setShown(false) }, "Withdraw"),
    open && shown
      ? createElement(Dialog, {
          labelledBy: titleId,
          busy,
          initialFocus: field,
          onDismiss: () => setOpen(false),
          onKeyDown: (event) => heard.dialogKeys.push(event.key),
          children: [
            createElement("h2", { key: "title", id: titleId }, "Rename plan"),
            createElement("input", {
              key: "name",
              ref: field,
              "aria-label": "Name",
              defaultValue: "Launch",
            }),
            createElement("button", { key: "cancel", type: "button" }, "Cancel"),
            createElement("button", { key: "save", type: "button" }, "Save"),
          ],
        })
      : null,
  );
}

/** The owner drawn, its dialog opened from its button by the pointer. */
async function opened(busy = false) {
  const heard: Heard = { keys: [], presses: 0, dialogKeys: [] };
  await mount(createElement(Owner, { heard, busy }));
  const opener = page.getByRole("button", { name: "Rename" });
  await opener.click();
  heard.presses = 0;
  const dialog = page.getByRole("dialog", { name: "Rename plan" });
  await expect.element(dialog).toBeInTheDocument();
  const backdrop = document.querySelector(".luke-dialog-backdrop") ?? expect.fail("no backdrop");
  return { heard, opener, dialog, backdrop };
}

test("it opens on its field, keeps Tab and Shift-Tab among its controls, and Escape hands focus back", async () => {
  const { opener, dialog } = await opened();
  await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveFocus();
  expect(await accessibilityViolations(dialog.element())).toEqual([]);
  await userEvent.keyboard("{Tab}{Tab}");
  await expect.element(page.getByRole("button", { name: "Save" })).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveFocus();
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await expect.element(page.getByRole("button", { name: "Save" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(opener).toHaveFocus();
});

test("a link or a select at either end of the card is one of its controls, so Tab wraps from it past what is out of the Tab order", async () => {
  await mount(
    createElement(Dialog, {
      labelledBy: "title",
      onDismiss: () => undefined,
      children: [
        createElement("h2", { key: "title", id: "title" }, "Invite"),
        createElement("div", { key: "details", tabIndex: -2 }, "Details"),
        createElement(
          "select",
          { key: "role", "aria-label": "Role" },
          createElement("option", null, "Member"),
        ),
        createElement("button", { key: "send", type: "button" }, "Send"),
        createElement("a", { key: "help", href: "#roles" }, "About roles"),
      ],
    }),
  );
  const link = page.getByRole("link", { name: "About roles" });
  const select = page.getByRole("combobox", { name: "Role" });
  link.element().focus();
  await userEvent.keyboard("{Tab}");
  await expect.element(select).toHaveFocus();
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await expect.element(link).toHaveFocus();
});

test("an input method's Escape and Return are its own, and the dialog hears its keys only once it is done", async () => {
  const { heard, dialog } = await opened();
  const field = page.getByRole("textbox", { name: "Name" }).element();
  for (const key of ["Escape", "Enter"]) {
    field.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing: true, bubbles: true }));
  }
  await expect.element(dialog).toBeInTheDocument();
  expect(heard.dialogKeys).toEqual([]);
  await userEvent.keyboard("{Enter}");
  expect(heard.dialogKeys).toEqual(["Enter"]);
});

test("no key and no press inside the card reaches the window behind it", async () => {
  const { heard } = await opened();
  await userEvent.keyboard("a{Enter}");
  await page.getByRole("button", { name: "Cancel" }).click();
  await userEvent.keyboard("{Escape}");
  expect(heard.keys).toEqual([]);
  expect(heard.presses).toBe(0);
});

test("a press dragged out of the card leaves it open, and one on the dimmed window alone puts it away", async () => {
  const { opener, dialog, backdrop } = await opened();
  dialog.element().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await expect.element(dialog).toBeInTheDocument();
  await page.elementLocator(backdrop).click({ position: { x: 4, y: 4 } });
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(opener).toHaveFocus();
});

test("taken away unanswered, as a surface closing behind it does, it still hands focus back", async () => {
  const { opener, dialog } = await opened();
  page
    .getByRole("button", { name: "Withdraw" })
    .element()
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(opener).toHaveFocus();
});

test("a busy dialog holds focus on its card, and Tab from there comes back onto its controls", async () => {
  const { dialog } = await opened(true);
  await expect.element(dialog).toHaveFocus();
  await expect.element(dialog).toHaveAttribute("aria-busy", "true");
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveFocus();
});

test("the card is never taller than the window: what it holds scrolls, and its title stays on screen", async () => {
  await mount(
    createElement(Dialog, {
      labelledBy: "title",
      onDismiss: () => undefined,
      children: [
        createElement("h2", { key: "title", id: "title" }, "Choose a workspace"),
        createElement(
          "div",
          { key: "rows", style: { minHeight: 0, overflowY: "auto" } },
          createElement("div", { style: { height: 4000 } }, "Rows"),
        ),
      ],
    }),
  );
  const card = page.getByRole("dialog", { name: "Choose a workspace" }).element();
  expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
  expect(card.querySelector("h2")?.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
});

test("a question that must be answered is an alert dialog, described by what it asks", async () => {
  await mount(
    createElement(Dialog, {
      role: DIALOG_ROLE.ALERT_DIALOG,
      labelledBy: "title",
      describedBy: "body",
      onDismiss: () => undefined,
      children: [
        createElement("h2", { key: "title", id: "title" }, "Delete plan?"),
        createElement("p", { key: "body", id: "body" }, "It goes for good."),
        createElement("button", { key: "delete", type: "button" }, "Delete"),
      ],
    }),
  );
  const question = page.getByRole("alertdialog", { name: "Delete plan?" });
  await expect.element(question).toHaveAccessibleDescription("It goes for good.");
  expect(await accessibilityViolations(question.element())).toEqual([]);
});

test("the compatibility twin is the same dialog with its caller's classes beside its own", async () => {
  const props = { labelledBy: "title", onDismiss: () => undefined, children: "Send feedback" };
  await mount(
    createElement(
      Fragment,
      null,
      createElement(Dialog, props),
      createElement(CompatDialog, {
        ...props,
        className: "feedback-dialog",
        backdropClassName: "quiet",
      }),
    ),
  );
  const [shared, twin] = document.querySelectorAll(".luke-dialog-backdrop");
  twin?.classList.remove("quiet");
  twin?.querySelector(".luke-dialog")?.classList.remove("feedback-dialog");
  expect(twin?.outerHTML).toBe(shared?.outerHTML);
});
