// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { useAppCommand, useMenuCommands } from "./app-commands";
import { ModalShell } from "./modal-shell";

/**
 * The menu bar's commands as the window runs them under a dialog: Back and
 * Forward, which a mouse's back and forward buttons reach the window as under
 * Logi Options+, move the page while nothing stands over it, and leave it
 * alone while a dialog's card holds the keyboard.
 */

let menuListener: ((command: AppCommand) => void) | undefined;
const roots: Root[] = [];

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      onMenuCommand: (listener: (command: AppCommand) => void) => {
        menuListener = listener;
        return () => {
          menuListener = undefined;
        };
      },
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
      ? createElement(ModalShell, {
          className: "card",
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
