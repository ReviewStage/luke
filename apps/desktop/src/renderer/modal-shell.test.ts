// @vitest-environment jsdom

import assert from "node:assert/strict";
import { FEEDBACK_KIND } from "@luke/features/feedback";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { tasksControl } from "#testing/tasks-control";
import { FeedbackDialog } from "./feedback-dialog";
import { ConfirmDialog, useConfirmDialog } from "./settings/confirm-dialog";
import { AttachmentViewer } from "./tasks/attachment-viewer";
import { NewTaskDialog } from "./tasks/new-task-dialog";

/**
 * Every modal over the window as the developer meets it: opened from a
 * button, it holds Tab, Escape and a press on the dimmed window put it away,
 * a press dragged out of the card puts nothing away, and however it goes,
 * focus goes back to the button that opened it. Each dialog stands in an
 * owner that opens it from that button and can take it away unanswered, as a
 * surface closing behind it does.
 */

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

beforeEach(() => {
  installScrollIntoView();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.innerHTML = "";
});

/** What each owner is handed: whether its surface still stands, and the button and dialog it draws. */
interface OwnerProps {
  shown: boolean;
}

/** An owner's opener and its dialog, drawn while `open`. */
function owned(open: () => void, dialog: ReactElement | null): ReactElement {
  return createElement(
    Fragment,
    null,
    createElement("button", { type: "button", onClick: open }, "Open"),
    dialog,
  );
}

function ConfirmOwner({ shown }: OwnerProps): ReactElement {
  const confirm = useConfirmDialog({ subject: true, surfaceOpen: shown }, () =>
    Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  );
  return owned(
    confirm.ask,
    createElement(ConfirmDialog, {
      confirm,
      question: { title: "Delete plan?", body: "It goes for good.", verb: "Delete", running: "" },
    }),
  );
}

function NewTaskOwner({ shown }: OwnerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const control = tasksControl();
  return owned(
    () => setOpen(true),
    createElement(NewTaskDialog, {
      newTask: {
        ...control.newTask,
        open: open && shown,
        repositoriesIn: () => ({ ...control.repositories, recent: ["acme/web"] }),
        onClose: () => setOpen(false),
      },
    }),
  );
}

function FeedbackOwner({ shown }: OwnerProps): ReactElement {
  const [open, setOpen] = useState(false);
  return owned(
    () => setOpen(true),
    createElement(FeedbackDialog, {
      kind: open && shown ? FEEDBACK_KIND.FEEDBACK : undefined,
      account: undefined,
      onClose: () => setOpen(false),
    }),
  );
}

const NOTES = {
  name: "notes.txt",
  mediaType: "text/plain",
  url: `data:text/plain;base64,${btoa("one\ntwo\n")}`,
} as const;

function AttachmentOwner({ shown }: OwnerProps): ReactElement {
  const [open, setOpen] = useState(false);
  return owned(
    () => setOpen(true),
    open && shown
      ? createElement(AttachmentViewer, {
          files: [NOTES],
          at: 0,
          onAt: () => undefined,
          onClose: () => setOpen(false),
        })
      : null,
  );
}

/** Each modal by the role its card carries. */
const DIALOGS = [
  { name: "a confirm", Owner: ConfirmOwner, role: "alertdialog" },
  { name: "New task", Owner: NewTaskOwner, role: "dialog" },
  { name: "Send feedback", Owner: FeedbackOwner, role: "dialog" },
  { name: "the attachment viewer", Owner: AttachmentOwner, role: "dialog" },
] as const;

type Dialog = (typeof DIALOGS)[number];

/** The owner drawn, its dialog opened from its button, and the ways to reach both. */
function open({ Owner, role }: Dialog) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  registries.push(registry);
  const draw = (shown: boolean) =>
    act(() => root.render(onRegistry(registry, createElement(Owner, { shown }))));
  draw(true);
  const opener =
    [...container.querySelectorAll("button")].find((each) => each.textContent === "Open") ??
    assert.fail("the owner draws its button");
  opener.focus();
  act(() => opener.click());
  const card = () => document.querySelector<HTMLElement>(`[role="${role}"][aria-modal="true"]`);
  assert.ok(card(), "the dialog opens");
  const backdrop = card()?.parentElement ?? assert.fail("no backdrop");
  const key = (key: string, shiftKey = false) =>
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }),
      );
    });
  const press = (from: Element, to: Element) =>
    act(() => {
      from.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      to.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  return { opener, card, backdrop, key, press, withdraw: () => draw(false) };
}

/**
 * Whether `element` holds the keyboard. Note that a focus is compared by
 * hand, because a failed `assert.equal` prints both elements, and a jsdom
 * element printed whole runs the worker out of memory.
 */
function holds(element: Element | null | undefined): boolean {
  return element !== null && element !== undefined && document.activeElement === element;
}

for (const dialog of DIALOGS) {
  test(`${dialog.name}: Escape puts it away and hands focus back to what opened it`, () => {
    const shown = open(dialog);
    assert.ok(!holds(shown.opener), "the dialog takes the keyboard");
    shown.key("Escape");
    assert.ok(shown.card() === null, "Escape puts the dialog away");
    assert.ok(holds(shown.opener), "focus goes back to the opener");
  });

  test(`${dialog.name}: Tab and Shift-Tab go round its own controls and never leave the card`, () => {
    const shown = open(dialog);
    const card = shown.card() ?? assert.fail("no card");
    const last = [...card.querySelectorAll<HTMLElement>("button:not([disabled])")].at(-1);
    last?.focus();
    shown.key("Tab");
    assert.ok(
      holds(card.querySelector("button:not([disabled]), textarea, input")),
      "Tab from the last control comes round to the first",
    );
    shown.key("Tab", true);
    assert.ok(holds(last), "Shift-Tab from the first control comes round to the last");
  });

  test(`${dialog.name}: a press dragged out of the card onto the dimmed window leaves it open, and one on the dimmed window alone puts it away`, () => {
    const shown = open(dialog);
    const card = shown.card() ?? assert.fail("no card");
    shown.press(card, shown.backdrop);
    assert.ok(
      shown.card() !== null,
      "a selection dragged out of the card is no press on the window",
    );
    shown.press(shown.backdrop, shown.backdrop);
    assert.ok(shown.card() === null, "a press on the dimmed window puts the dialog away");
    assert.ok(holds(shown.opener), "focus goes back to the opener");
  });

  test(`${dialog.name}: taken away unanswered, as a surface closing does, it still hands focus back to what opened it`, () => {
    const shown = open(dialog);
    shown.withdraw();
    assert.ok(shown.card() === null, "the dialog goes with its surface");
    assert.ok(holds(shown.opener), "focus goes back to the opener");
  });
}
