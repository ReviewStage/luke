// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_COMMAND, APP_SHORTCUTS, COMMAND_KEY, type CommandKey } from "@repo/settings/shortcuts";
import { Shortcut } from "@repo/ui";
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useAppCommand, useAppKeymap } from "./app-commands.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PALETTE = APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE].chord;

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  fakeAppPlatform(QUIET_PANEL);
});

function PaletteWindow({ opened }: { opened: string[] }): ReactElement {
  useAppKeymap(true);
  useAppCommand(APP_COMMAND.COMMAND_PALETTE, () => opened.push("palette"));
  return createElement(Fragment, null, createElement(Shortcut, { chord: PALETTE }));
}

function drawWindow(commandKey: CommandKey | undefined): string[] {
  fakeAppPlatform({ ...QUIET_PANEL, ...(commandKey === undefined ? undefined : { commandKey }) });
  const opened: string[] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(PaletteWindow, { opened })));
  return opened;
}

function pressK(held: "ctrlKey" | "metaKey"): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", code: "KeyK", bubbles: true, [held]: true }),
    );
  });
}

function hint(): string {
  return [...document.querySelectorAll(".ui-shortcut-glyph")]
    .map((glyph) => glyph.textContent)
    .join(" ");
}

test("where the shell names Ctrl, Ctrl+K opens the command palette, ⌘K opens nothing, and the hint reads Ctrl K", () => {
  const opened = drawWindow(COMMAND_KEY.CONTROL);

  pressK("metaKey");
  assert.deepEqual(opened, []);
  pressK("ctrlKey");
  assert.deepEqual(opened, ["palette"]);
  assert.equal(hint(), "Ctrl K");
});

test("where the shell names no command key, as the Mac app, ⌘K opens the command palette, Ctrl+K opens nothing, and the hint reads ⌘ K", () => {
  const opened = drawWindow(undefined);

  pressK("ctrlKey");
  assert.deepEqual(opened, []);
  pressK("metaKey");
  assert.deepEqual(opened, ["palette"]);
  assert.equal(hint(), "⌘ K");
});
