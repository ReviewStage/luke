import assert from "node:assert/strict";
import type { MenuItemConstructorOptions } from "electron";
import { test, vi } from "vitest";
import { channels } from "#shared/bridge";
import { APP_COMMAND } from "#shared/shortcuts";
import { appMenuTemplate } from "./app-menu";

/** A browser window as the menu is handed one: only the page it sends to. */
const { FakeBrowserWindow } = vi.hoisted(() => ({
  FakeBrowserWindow: class {
    readonly sent: [string, string][] = [];
    readonly webContents = {
      send: (channel: string, command: string) => this.sent.push([channel, command]),
    };
  },
}));

vi.mock("electron", () => ({ BrowserWindow: FakeBrowserWindow }));

function item(label: string): MenuItemConstructorOptions {
  const found = appMenuTemplate("Luke")
    .flatMap((menu) => (Array.isArray(menu.submenu) ? menu.submenu : []))
    .find((each) => each.label === label);
  assert.ok(found?.click, `the menu bar offers ${label}`);
  return found;
}

/** Chooses an item over a window, by a click or by its key. */
function choose(
  label: string,
  window: InstanceType<typeof FakeBrowserWindow>,
  byKey: boolean,
): void {
  const click = item(label).click;
  assert.ok(click);
  // SAFETY: the menu reads only the window's page and the event's one flag.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- a fake window stands in for Electron's class, which the test cannot construct.
  click(
    undefined as never,
    window as unknown as Electron.BaseWindow,
    {
      triggeredByAccelerator: byKey,
    } as Electron.KeyboardEvent,
  );
}

test("an item clicked in the menu bar hands its command to the window it was chosen over", () => {
  const window = new FakeBrowserWindow();
  choose("Delete Plan", window, false);
  assert.deepEqual(window.sent, [[channels.onMenuCommand, APP_COMMAND.DELETE_PLAN]]);
});

test("a key the window left unclaimed runs no item: a text field's ⌘⌫ and the window's Escape stay theirs", () => {
  const window = new FakeBrowserWindow();
  choose("Delete Plan", window, true);
  choose("Exit Full Screen", window, true);
  assert.deepEqual(window.sent, []);
});
