// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_COMMAND, type AppCommand } from "@luke/settings/shortcuts";
import { Dialog } from "@luke/ui";
import { act, createElement, Fragment, type ReactElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { useAppCommand, useAppKeymap, useMenuCommands } from "./app-commands.js";
import { useFocusedRowKeys } from "./desktop/task-actions.js";
import { fakeAppPlatform } from "./testing/app-platform.js";

/**
 * The menu bar's commands as the window runs them under a dialog: Back and
 * Forward, which a mouse's back and forward buttons reach the window as under
 * Logi Options+, move the page while nothing stands over it, and leave it
 * alone while a dialog's card holds the keyboard.
 */

let menuListener: ((command: AppCommand) => void) | undefined;
const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform({
    onMenuCommand: (listener: (command: AppCommand) => void) => {
      menuListener = listener;
      return () => {
        menuListener = undefined;
      };
    },
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** A window whose history offers Back and Forward, each move recorded, with a dialog over it while `dialog`. */
function HistoryWindow({ moves, dialog }: { moves: string[]; dialog: boolean }): ReactElement {
  useMenuCommands(true);
  useAppCommand(APP_COMMAND.BACK, () => moves.push("back"));
  useAppCommand(APP_COMMAND.FORWARD, () => moves.push("forward"));
  return createElement(
    Fragment,
    null,
    dialog
      ? createElement(Dialog, {
          open: true,
          labelledBy: "title",
          onDismiss: () => undefined,
          children: createElement("h2", { id: "title" }, "Delete plan?"),
        })
      : null,
  );
}

/** The window drawn, redrawn with its dialog shown or not by the function answered. */
function drawWindow(moves: string[]): (dialog: boolean) => void {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const draw = (dialog: boolean) =>
    act(() => root.render(createElement(HistoryWindow, { moves, dialog })));
  draw(false);
  return draw;
}

/** Chooses `command` from the menu bar, or swipes for it. */
function menu(command: AppCommand): void {
  act(() => menuListener?.(command));
}

test("the menu bar's Back and Forward move the window while nothing stands over it", () => {
  const moves: string[] = [];
  drawWindow(moves);
  menu(APP_COMMAND.BACK);
  menu(APP_COMMAND.FORWARD);
  assert.deepEqual(moves, ["back", "forward"]);
});

test("a dialog standing holds off the menu bar's Back and Forward, which run again once it is put away", () => {
  const moves: string[] = [];
  const draw = drawWindow(moves);
  draw(true);
  menu(APP_COMMAND.BACK);
  menu(APP_COMMAND.FORWARD);
  assert.deepEqual(moves, [], "the page behind the dialog stays where it was");

  draw(false);
  menu(APP_COMMAND.BACK);
  assert.deepEqual(moves, ["back"]);
});

/** A window whose keymap answers, offering the Inbox's J, each press recorded, with a field to type in. */
function KeyedWindow({ moves }: { moves: string[] }): ReactElement {
  useAppKeymap(true);
  useAppCommand(APP_COMMAND.NEXT_INBOX_ITEM, () => moves.push("inbox"));
  return createElement("textarea", { "aria-label": "Message" });
}

/** Presses J where the press lands. */
function pressJ(target: EventTarget): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true }));
  });
}

test("J runs the Inbox's command, and nothing while the press is typing into a field", () => {
  const moves: string[] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(KeyedWindow, { moves })));
  pressJ(document.body);
  pressJ(document.querySelector("textarea") ?? assert.fail("the field"));
  assert.deepEqual(moves, ["inbox"]);
});

/** What the open thing offers on U, P, and S, each press recorded: a plan's, say. */
function OpenThing({ presses }: { presses: string[] }): null {
  useAppCommand(APP_COMMAND.TOGGLE_READ, () => presses.push("open read"));
  useAppCommand(APP_COMMAND.PIN, () => presses.push("open pin"));
  useAppCommand(APP_COMMAND.SET_STATUS, () => presses.push("open status"));
  return null;
}

/** A sidebar row that takes the keyboard, offering U, P, and S while it holds it. */
function FocusableRow({ presses }: { presses: string[] }): ReactElement {
  const row = useRef<HTMLDivElement | null>(null);
  useFocusedRowKeys(
    row,
    () => presses.push("row read"),
    () => presses.push("row pin"),
    () => presses.push("row status"),
  );
  return createElement("div", { ref: row, tabIndex: 0, "aria-label": "Row" });
}

/** The keymap with the open thing, mounted anew under `opened`, beside a focusable row. */
function RowWindow({ presses, opened }: { presses: string[]; opened: number }): ReactElement {
  useAppKeymap(true);
  return createElement(
    Fragment,
    null,
    createElement(OpenThing, { key: opened, presses }),
    createElement(FocusableRow, { presses }),
  );
}

/** Presses a letter alone where the keyboard is. */
function pressLetter(key: "u" | "p" | "s"): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, bubbles: true }),
    );
  });
}

test("U, P, and S act on the focused sidebar row over the open thing, even once the open thing offers them again after it, and on the open thing once the row lets the keyboard go", () => {
  const presses: string[] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const draw = (opened: number) =>
    act(() => root.render(createElement(RowWindow, { presses, opened })));
  draw(0);
  pressLetter("u");
  assert.deepEqual(presses.splice(0), ["open read"]);

  const row = document.querySelector<HTMLElement>('[aria-label="Row"]') ?? assert.fail("the row");
  act(() => row.focus());
  // The open thing mounting again makes its offers the newest, which must not take the letters from the row.
  draw(1);
  pressLetter("u");
  pressLetter("p");
  pressLetter("s");
  assert.deepEqual(presses.splice(0), ["row read", "row pin", "row status"]);

  act(() => row.blur());
  pressLetter("p");
  pressLetter("s");
  assert.deepEqual(presses.splice(0), ["open pin", "open status"]);
});
