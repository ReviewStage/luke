// @vitest-environment jsdom

import { act, createElement, useId, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { DIALOG_ROLE, Dialog } from "./dialog.js";

/**
 * dialog.test.ts -- a dialog opened from a button takes the keyboard and
 * keeps Tab among its own controls, links and selects among them and
 * whatever is out of the Tab order not; Escape, a press on the dimmed
 * window, or its owner taking it away puts it away and hands focus back to
 * the button; a press dragged out of the card puts nothing away; an input
 * method's keys stay the method's; no key or press inside reaches the window
 * behind; a busy dialog holds focus on its card until it is done; and one
 * given a title and actions is named by the title, its answers after what
 * it holds.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

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

/** What the window behind the dialog heard, which should be nothing, and the keys the dialog heard. */
interface Heard {
  keys: string[];
  presses: number;
  dialogKeys: string[];
}

/** A window holding the button that opens a dialog with a field and two answers, and a button that withdraws it. */
function Owner({ heard, busy }: { heard: Heard; busy: boolean }): React.JSX.Element {
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

/** Draws `element` into the page. */
function draw(element: React.ReactElement): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

/** The button named `name`. */
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((each) => each.textContent === name);
  return found ?? expect.fail(`no ${name} button`);
}

/** The modal card of `role`, if one stands. */
function card(role: string = DIALOG_ROLE.DIALOG): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[role="${role}"][aria-modal="true"]`);
}

/** The card's name, read from what its `aria-labelledby` points at. */
function nameOf(element: HTMLElement): string | null | undefined {
  const id = element.getAttribute("aria-labelledby");
  return id === null ? undefined : document.getElementById(id)?.textContent;
}

/** A key pressed on whatever holds focus. */
function key(name: string, init: KeyboardEventInit = {}): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, ...init }),
    );
  });
}

/** A press that goes down on `from` and comes up on `to`. */
function press(from: Element, to: Element): void {
  act(() => {
    from.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    to.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Whether `element` holds the keyboard. */
function holds(element: Element | null | undefined): boolean {
  return element !== null && element !== undefined && document.activeElement === element;
}

/** The owner drawn and its dialog opened from its button, which holds focus as it is pressed. */
function opened(busy = false) {
  const heard: Heard = { keys: [], presses: 0, dialogKeys: [] };
  draw(createElement(Owner, { heard, busy }));
  const opener = button("Rename");
  opener.focus();
  act(() => opener.click());
  heard.presses = 0;
  const dialog = card() ?? expect.fail("the dialog opens");
  const backdrop = dialog.parentElement ?? expect.fail("no dimmed window");
  const field =
    dialog.querySelector<HTMLInputElement>('input[aria-label="Name"]') ?? expect.fail("no field");
  return { heard, opener, dialog, backdrop, field };
}

test("it opens named by its title on its field, keeps Tab and Shift-Tab among its controls, and Escape hands focus back", () => {
  const { opener, dialog, field } = opened();
  expect(nameOf(dialog)).toBe("Rename plan");
  expect(holds(field)).toBe(true);
  button("Save").focus();
  key("Tab");
  expect(holds(field)).toBe(true);
  key("Tab", { shiftKey: true });
  expect(holds(button("Save"))).toBe(true);
  key("Escape");
  expect(card()).toBeNull();
  expect(holds(opener)).toBe(true);
});

test("a link or a select at either end of the card is one of its controls, and what is out of the Tab order is not", () => {
  draw(
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
  const link = document.querySelector("a") ?? expect.fail("no link");
  const select = document.querySelector("select") ?? expect.fail("no select");
  link.focus();
  key("Tab");
  expect(holds(select)).toBe(true);
  key("Tab", { shiftKey: true });
  expect(holds(link)).toBe(true);
});

test("an input method's Escape and Return are its own, and the dialog hears its keys only once it is done", () => {
  const { heard } = opened();
  key("Escape", { isComposing: true });
  key("Enter", { isComposing: true });
  expect(card()).not.toBeNull();
  expect(heard.dialogKeys).toEqual([]);
  key("Enter");
  expect(heard.dialogKeys).toEqual(["Enter"]);
});

test("no key and no press inside the card reaches the window behind it", () => {
  const { heard } = opened();
  key("a");
  key("Enter");
  act(() => button("Cancel").click());
  key("Escape");
  expect(heard.keys).toEqual([]);
  expect(heard.presses).toBe(0);
});

test("a press dragged out of the card leaves it open, and one on the dimmed window alone puts it away", () => {
  const { opener, dialog, backdrop } = opened();
  press(dialog, backdrop);
  expect(card()).not.toBeNull();
  press(backdrop, backdrop);
  expect(card()).toBeNull();
  expect(holds(opener)).toBe(true);
});

test("taken away unanswered, as a surface closing behind it does, it still hands focus back", () => {
  const { opener } = opened();
  act(() => button("Withdraw").click());
  expect(card()).toBeNull();
  expect(holds(opener)).toBe(true);
});

test("a busy dialog holds focus on its card, and Tab from there comes back onto its controls", () => {
  const { dialog, field } = opened(true);
  expect(holds(dialog)).toBe(true);
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  key("Tab");
  expect(holds(field)).toBe(true);
});

test("a question that must be answered is an alert dialog, named by its title and described by what it asks", () => {
  draw(
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
  const question = card(DIALOG_ROLE.ALERT_DIALOG) ?? expect.fail("no alert dialog");
  expect(nameOf(question)).toBe("Delete plan?");
  const described = question.getAttribute("aria-describedby");
  expect(described && document.getElementById(described)?.textContent).toBe("It goes for good.");
});

test("a dialog given a title and actions is named by its title, and what it holds comes before its tool and then its answers, Tab wrapping from the last answer", () => {
  const field = { current: null as HTMLTextAreaElement | null };
  draw(
    createElement(Dialog, {
      title: "Send feedback",
      initialFocus: field,
      onDismiss: () => undefined,
      actionsStart: createElement("button", { type: "button" }, "Attach"),
      actions: [
        createElement("button", { key: "cancel", type: "button" }, "Cancel"),
        createElement("button", { key: "send", type: "button" }, "Send"),
      ],
      children: createElement("textarea", { ref: field, "aria-label": "Feedback" }),
    }),
  );
  const dialog = card() ?? expect.fail("the dialog opens");
  expect(nameOf(dialog)).toBe("Send feedback");
  expect(dialog.querySelector("h2")?.textContent).toBe("Send feedback");
  expect(holds(field.current)).toBe(true);
  const controls = [...dialog.querySelectorAll("textarea, button")].map(
    (control) => control.textContent || control.getAttribute("aria-label"),
  );
  expect(controls).toEqual(["Feedback", "Attach", "Cancel", "Send"]);
  button("Send").focus();
  key("Tab");
  expect(holds(field.current)).toBe(true);
});
