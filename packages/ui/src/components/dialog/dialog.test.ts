// @vitest-environment jsdom

import { act, createElement, createRef, useId, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { MOTION_TOKEN } from "../../motion-timing.js";
import { holdExits } from "../../testing/held-exits.js";
import { Announcer } from "../announcer/announcer.js";
import {
  DIALOG_ROLE,
  DIALOG_SIZE,
  DIALOG_VEIL,
  Dialog,
  type DialogHandle,
  nextRowOrHead,
} from "./dialog.js";

/**
 * dialog.test.ts -- a dialog opened from a button takes the keyboard and
 * keeps Tab among its own controls, links and selects among them and
 * whatever is out of the Tab order not; Escape, a press on the dimmed
 * window, or its owner taking it away puts it away and hands focus back to
 * the button; a press dragged out of the card puts nothing away; an input
 * method's keys stay the method's; no key or press inside reaches the window
 * behind; a busy dialog holds focus on its card until it is done, and
 * its owner still hears it asked away meanwhile; one
 * given a title and actions is named by the title, its answers after what
 * it holds; one its owner closes through `open` fades out before it
 * goes, or goes at once where motion is held, and hands focus back once it
 * has gone; and one whose act took its opener's row away hands focus to the
 * row after it, or to the list's head where none is left.
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
  document.body.style.removeProperty(MOTION_TOKEN.DURATION_FAST);
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  vi.useRealTimers();
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
          open: true,
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
      open: true,
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

test("Safari's composing key, code 229 with isComposing already false, is the input method's too", () => {
  const { heard } = opened();
  key("Enter", { keyCode: 229 });
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

test("a card the window's size is put away by a press on its veil, and not by one on what the veil holds", () => {
  let dismissed = 0;
  draw(
    createElement(Dialog, {
      open: true,
      size: DIALOG_SIZE.WINDOW,
      title: "shot.png",
      onDismiss: () => {
        dismissed += 1;
      },
      children: createElement(
        "div",
        { ...DIALOG_VEIL, "data-testid": "veil" },
        createElement("img", { alt: "shot.png" }),
      ),
    }),
  );
  const veil = document.querySelector("[data-testid=veil]") ?? expect.fail("the veil stands");
  const picture = veil.querySelector("img") ?? expect.fail("the picture stands");
  press(picture, picture);
  press(picture, veil);
  expect(dismissed).toBe(0);
  press(veil, veil);
  expect(dismissed).toBe(1);
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

test("asked away while busy, by the dimmed window or Escape, its owner still hears it each time", () => {
  let dismissals = 0;
  draw(
    createElement(Dialog, {
      open: true,
      title: "Deleting plan",
      busy: true,
      onDismiss: () => {
        dismissals += 1;
      },
      children: createElement("p", null, "Deleting."),
    }),
  );
  const dialog = card() ?? expect.fail("the dialog opens");
  const backdrop = dialog.parentElement ?? expect.fail("no dimmed window");

  press(backdrop, backdrop);
  key("Escape");
  expect(dismissals).toBe(2);
});

test("a question that must be answered is an alert dialog, named by its title and described by what it asks", () => {
  draw(
    createElement(Dialog, {
      open: true,
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
  const field = createRef<HTMLTextAreaElement>();
  draw(
    createElement(Dialog, {
      open: true,
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

test("a dialog holding a draft is kept by the first Escape or press on the dimmed window, says why, and is put away by the next; one holding none goes at once", () => {
  let dismissals = 0;
  const drawn = (holding: boolean) =>
    createElement(Dialog, {
      open: true,
      title: "Send feedback",
      holding,
      onDismiss: () => {
        dismissals += 1;
      },
      children: createElement("textarea", { "aria-label": "Feedback" }),
    });
  draw(createElement(Announcer));
  draw(drawn(true));
  const root = roots.at(-1) ?? expect.fail("no root");
  const dialog = card() ?? expect.fail("the dialog opens");
  const backdrop = dialog.parentElement ?? expect.fail("no dimmed window");
  press(backdrop, backdrop);
  const afterFirst = {
    dismissals,
    told: document.querySelector('[role="status"]')?.textContent,
  };
  key("Escape");
  const afterSecond = dismissals;
  act(() => root.render(drawn(false)));
  key("Escape");

  expect(afterFirst).toEqual({
    dismissals: 0,
    told: "Your draft is kept. Press Escape again to close.",
  });
  expect(afterSecond).toBe(1);
  expect(dismissals).toBe(2);
});

test("an owner asks its dialog away through its handle as Escape would, a draft holding it back the same way", () => {
  let dismissals = 0;
  const handle = createRef<DialogHandle>();
  draw(
    createElement(Dialog, {
      open: true,
      ref: handle,
      title: "New task",
      holding: true,
      onDismiss: () => {
        dismissals += 1;
      },
      children: createElement("textarea", { "aria-label": "Words" }),
    }),
  );
  act(() => handle.current?.dismiss());
  const afterFirst = dismissals;
  act(() => handle.current?.dismiss());

  expect(afterFirst).toBe(0);
  expect(dismissals).toBe(1);
});

/** A dialog that opens a second over itself, as a confirm asked from inside a settings card is. */
function Stacked({ onOuter, onInner }: { onOuter: () => void; onInner: () => void }) {
  const [inner, setInner] = useState(false);
  return createElement(Dialog, {
    open: true,
    title: "Settings",
    onDismiss: onOuter,
    children: [
      createElement("button", { key: "ask", type: "button", onClick: () => setInner(true) }, "Ask"),
      inner
        ? createElement(Dialog, {
            open: true,
            key: "inner",
            role: DIALOG_ROLE.ALERT_DIALOG,
            title: "Delete key?",
            onDismiss: () => {
              onInner();
              setInner(false);
            },
            children: createElement("button", { type: "button" }, "Keep"),
          })
        : null,
    ],
  });
}

test("a dialog opened over another is the one Escape puts away, and the one beneath stays until the next", () => {
  const dismissed: string[] = [];
  draw(
    createElement(Stacked, {
      onOuter: () => dismissed.push("outer"),
      onInner: () => dismissed.push("inner"),
    }),
  );
  act(() => button("Ask").click());
  expect(card(DIALOG_ROLE.ALERT_DIALOG)).not.toBeNull();
  key("Escape");
  const afterFirst = [...dismissed];
  key("Escape");

  expect(afterFirst).toEqual(["inner"]);
  expect(card(DIALOG_ROLE.ALERT_DIALOG)).toBeNull();
  expect(dismissed).toEqual(["inner", "outer"]);
});

/** A window holding the button that opens a dialog through `open`, whose Done closes it the same way. */
function OpenOwner({ onExited }: { onExited?: (() => void) | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setOpen(true) }, "Rename"),
    createElement(Dialog, {
      open,
      title: "Rename plan",
      onDismiss: () => setOpen(false),
      onExited,
      children: createElement("button", { type: "button", onClick: () => setOpen(false) }, "Done"),
    }),
  );
}

/** The owner drawn, its dialog opened from its button, and then closed by Done. */
function closedThroughOpen(onExited?: () => void): HTMLButtonElement {
  draw(createElement(OpenOwner, { onExited }));
  const opener = button("Rename");
  opener.focus();
  act(() => opener.click());
  expect(card()).not.toBeNull();
  act(() => button("Done").click());
  return opener;
}

test("a dialog its owner closes through open stays drawn until its fade has run, then goes, handing focus back to its opener", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  const opener = closedThroughOpen();
  const leaving = card();
  const focusWhileFading = holds(opener);
  act(() => vi.advanceTimersToNextFrame());
  const standsAFrameOn = card() !== null;
  await act(async () => exits.finish());

  expect(leaving).not.toBeNull();
  expect(focusWhileFading).toBe(false);
  expect(standsAFrameOn).toBe(true);
  expect(card()).toBeNull();
  expect(holds(opener)).toBe(true);
});

test("a dialog closed through open while motion is held goes at once", () => {
  document.body.style.setProperty(MOTION_TOKEN.DURATION_FAST, "0s");
  holdExits();
  const opener = closedThroughOpen();

  expect(card()).toBeNull();
  expect(holds(opener)).toBe(true);
});

test("a dialog tells its owner it is gone once its fade has run, and not before", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  const gone = vi.fn();
  closedThroughOpen(gone);
  act(() => vi.advanceTimersToNextFrame());
  const whileFading = gone.mock.calls.length;
  await act(async () => exits.finish());

  expect(whileFading).toBe(0);
  expect(gone).toHaveBeenCalledTimes(1);
});

test("a dialog closed while motion is held tells its owner it is gone at once", () => {
  document.body.style.setProperty(MOTION_TOKEN.DURATION_FAST, "0s");
  holdExits();
  const gone = vi.fn();
  closedThroughOpen(gone);

  expect(card()).toBeNull();
  expect(gone).toHaveBeenCalledTimes(1);
});

test("a dialog that never opened has no exit to tell its owner of", () => {
  const gone = vi.fn();
  draw(createElement(OpenOwner, { onExited: gone }));

  expect(gone).not.toHaveBeenCalled();
});

/** A list of rows, each with a Delete that asks first in a dialog whose answer takes the row away, focus handed on as `nextRowOrHead` says. */
function RowsOwner({ names }: { names: readonly string[] }): React.JSX.Element {
  const [rows, setRows] = useState(names);
  const [asked, setAsked] = useState<string | undefined>(undefined);
  return createElement(
    "div",
    null,
    createElement(
      "ul",
      null,
      rows.map((name) =>
        createElement(
          "li",
          { key: name },
          createElement("button", { type: "button", onClick: () => setAsked(name) }, name),
        ),
      ),
    ),
    createElement(Dialog, {
      open: asked !== undefined,
      title: "Delete row?",
      restoreTo: nextRowOrHead,
      onDismiss: () => setAsked(undefined),
      children: createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            setRows((now) => now.filter((name) => name !== asked));
            setAsked(undefined);
          },
        },
        "Delete",
      ),
    }),
  );
}

/** The rows drawn, the one named `name` asked about from its own button, and the question answered Delete. */
function deletedFromList(names: readonly string[], name: string): void {
  draw(createElement(RowsOwner, { names }));
  const opener = button(name);
  opener.focus();
  act(() => opener.click());
  expect(card()).not.toBeNull();
  act(() => button("Delete").click());
}

test("a dialog whose act took its opener's row hands focus to the row after it once its fade has run", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  deletedFromList(["Alpha", "Beta", "Gamma"], "Beta");
  const next = button("Gamma");
  act(() => vi.advanceTimersToNextFrame());
  const focusWhileFading = holds(next);
  await act(async () => exits.finish());

  expect(focusWhileFading).toBe(false);
  expect(card()).toBeNull();
  expect(holds(next)).toBe(true);
});

test("a dialog whose act took the last row hands focus to the list's head", () => {
  document.body.style.setProperty(MOTION_TOKEN.DURATION_FAST, "0s");
  holdExits();
  deletedFromList(["Alpha", "Beta", "Gamma"], "Gamma");

  expect(card()).toBeNull();
  expect(holds(button("Alpha"))).toBe(true);
});

/** One row that asks before it is deleted, its question drawn inside it, so deleting it takes the question with it. */
function AskingRow({ name, onDelete }: { name: string; onDelete: () => void }): React.JSX.Element {
  const [asked, setAsked] = useState(false);
  return createElement(
    "li",
    null,
    createElement("button", { type: "button", onClick: () => setAsked(true) }, name),
    createElement(Dialog, {
      open: asked,
      title: "Delete row?",
      restoreTo: nextRowOrHead,
      onDismiss: () => setAsked(false),
      children: createElement("button", { type: "button", onClick: onDelete }, "Delete"),
    }),
  );
}

/** A list whose rows each hold their own question. */
function AskingRows({ names }: { names: readonly string[] }): React.JSX.Element {
  const [rows, setRows] = useState(names);
  return createElement(
    "ul",
    null,
    rows.map((name) =>
      createElement(AskingRow, {
        key: name,
        name,
        onDelete: () => setRows((now) => now.filter((each) => each !== name)),
      }),
    ),
  );
}

test("a dialog unmounted with the row its act took away hands focus to the row after it", async () => {
  draw(createElement(AskingRows, { names: ["Alpha", "Beta", "Gamma"] }));
  const opener = button("Beta");
  opener.focus();
  act(() => opener.click());
  expect(card()).not.toBeNull();
  await act(async () => button("Delete").click());

  expect(card()).toBeNull();
  expect(holds(button("Gamma"))).toBe(true);
});

/** Threads in a list, each holding its comments in a list of their own, and the one comment of the first thread asked about; deleting it takes its thread with it. */
function ThreadsOwner(): React.JSX.Element {
  const [threads, setThreads] = useState(["First", "Second"]);
  const [asked, setAsked] = useState(false);
  return createElement(
    "div",
    null,
    createElement(
      "ul",
      null,
      threads.map((thread) =>
        createElement(
          "li",
          { key: thread },
          createElement(
            "ul",
            null,
            createElement(
              "li",
              null,
              createElement("button", { type: "button", onClick: () => setAsked(true) }, thread),
            ),
          ),
        ),
      ),
    ),
    createElement(Dialog, {
      open: asked,
      title: "Delete comment?",
      restoreTo: nextRowOrHead,
      onDismiss: () => setAsked(false),
      children: createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            setThreads((now) => now.filter((thread) => thread !== "First"));
            setAsked(false);
          },
        },
        "Delete",
      ),
    }),
  );
}

test("a dialog whose act took the opener's whole list hands focus to the row after the one around it", () => {
  document.body.style.setProperty(MOTION_TOKEN.DURATION_FAST, "0s");
  holdExits();
  draw(createElement(ThreadsOwner));
  const opener = button("First");
  opener.focus();
  act(() => opener.click());
  act(() => button("Delete").click());

  expect(card()).toBeNull();
  expect(holds(button("Second"))).toBe(true);
});
