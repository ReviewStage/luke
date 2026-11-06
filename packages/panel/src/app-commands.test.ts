// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_COMMAND, type AppCommand } from "@repo/settings/shortcuts";
import { Dialog } from "@repo/ui";
import { act, createElement, Fragment, type ReactElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { useAppCommand, useAppKeymap, useMenuCommands, useMenuOffers } from "./app-commands.js";
import { useFocusedRowKeys } from "./desktop/task-actions.js";
import { fakeAppPlatform } from "./testing/app-platform.js";

let menuListener: ((command: AppCommand) => void) | undefined;
let toldOffers: (readonly AppCommand[])[] = [];
const roots: Root[] = [];

beforeEach(() => {
  toldOffers = [];
  fakeAppPlatform({
    menuOffers: (commands: readonly AppCommand[]) => toldOffers.push(commands),
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

function drawWindow(moves: string[]): (dialog: boolean) => void {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const draw = (dialog: boolean) =>
    act(() => root.render(createElement(HistoryWindow, { moves, dialog })));
  draw(false);
  return draw;
}

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

function KeyedWindow({ moves }: { moves: string[] }): ReactElement {
  useAppKeymap(true);
  useAppCommand(APP_COMMAND.NEXT_INBOX_ITEM, () => moves.push("inbox"));
  useAppCommand(APP_COMMAND.UNDO, () => moves.push("undo"));
  return createElement("textarea", { "aria-label": "Message" });
}

function pressJ(target: EventTarget): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true }));
  });
}

function pressUndo(target: EventTarget): boolean {
  const press = new KeyboardEvent("keydown", {
    key: "z",
    code: "KeyZ",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(press);
  });
  return press.defaultPrevented;
}

test("J and ⌘Z run their commands, and nothing while the press is typing into a field, which keeps ⌘Z as its own undo", () => {
  const moves: string[] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(KeyedWindow, { moves })));
  const field = document.querySelector("textarea") ?? assert.fail("the field");
  pressJ(document.body);
  pressJ(field);
  const claimed = pressUndo(document.body);
  const claimedInField = pressUndo(field);
  assert.deepEqual(moves, ["inbox", "undo"]);
  assert.equal(claimed, true);
  assert.equal(claimedInField, false, "the field's own undo answers it");
});

function OpenThing({ presses }: { presses: string[] }): null {
  useAppCommand(APP_COMMAND.TOGGLE_READ, () => presses.push("open read"));
  useAppCommand(APP_COMMAND.PIN, () => presses.push("open pin"));
  useAppCommand(APP_COMMAND.SET_STATUS, () => presses.push("open status"));
  return null;
}

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

function RowWindow({ presses, opened }: { presses: string[]; opened: number }): ReactElement {
  useAppKeymap(true);
  return createElement(
    Fragment,
    null,
    createElement(OpenThing, { key: opened, presses }),
    createElement(FocusableRow, { presses }),
  );
}

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

function OfferingWindow({ linked }: { linked: boolean }): ReactElement | null {
  useMenuOffers();
  useAppCommand(APP_COMMAND.BACK, () => undefined);
  useAppCommand(APP_COMMAND.COPY_LINK, linked ? () => undefined : undefined);
  return null;
}

test("the window tells the menu bar the commands it offers as one set each time the set changes, and nothing when a redraw changes none", async () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const draw = async (linked: boolean) => {
    await act(async () => {
      root.render(createElement(OfferingWindow, { linked }));
      await Promise.resolve();
    });
  };

  await draw(false);
  await draw(false);
  await draw(true);
  await draw(false);

  assert.deepEqual(toldOffers, [
    [APP_COMMAND.BACK],
    [APP_COMMAND.BACK, APP_COMMAND.COPY_LINK].toSorted(),
    [APP_COMMAND.BACK],
  ]);
});
