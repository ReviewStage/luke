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
    closes = 0;
    close(): void {
      this.closes += 1;
    }
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
  choose("Permanently Delete Plan", window, false);
  assert.deepEqual(window.sent, [[channels.onMenuCommand, APP_COMMAND.DELETE_PLAN]]);
});

test("a key the window left unclaimed runs no item: a text field's ⌘⌫ and the window's Escape stay theirs", () => {
  const window = new FakeBrowserWindow();
  choose("Permanently Delete Plan", window, true);
  choose("Exit Full Screen", window, true);
  assert.deepEqual(window.sent, []);
});

test("Go holds Back and Forward, each handed to the window it was chosen over", () => {
  const go = appMenuTemplate("Luke").find((menu) => menu.label === "Go");
  assert.ok(Array.isArray(go?.submenu));
  assert.deepEqual(
    go.submenu.map((each) => [each.label, each.accelerator]),
    [
      ["Back", "Command+["],
      ["Forward", "Command+]"],
    ],
  );
  const window = new FakeBrowserWindow();
  choose("Back", window, false);
  choose("Forward", window, false);
  assert.deepEqual(window.sent, [
    [channels.onMenuCommand, APP_COMMAND.BACK],
    [channels.onMenuCommand, APP_COMMAND.FORWARD],
  ]);
});

test("Help offers the two notes to the people who make Luke, each handing the window its own command", () => {
  const window = new FakeBrowserWindow();
  choose("Send Feedback…", window, false);
  choose("Suggest a Feature…", window, false);
  assert.deepEqual(window.sent, [
    [channels.onMenuCommand, APP_COMMAND.SEND_FEEDBACK],
    [channels.onMenuCommand, APP_COMMAND.SUGGEST_FEATURE],
  ]);
});

test("File's New Tab and Close Tab hand the window their commands on a click, leaving ⌘T and ⌘W to the window's keymap, and Close Window closes the window on ⇧⌘W or a click", () => {
  const file = appMenuTemplate("Luke").find((menu) => menu.label === "File");
  assert.ok(Array.isArray(file?.submenu));
  assert.deepEqual(
    file.submenu
      .filter((each) => each.label?.endsWith("Tab") || each.label?.startsWith("Close"))
      .map((each) => [each.label, each.accelerator]),
    [
      ["New Tab", "Command+T"],
      ["Close Tab", "Command+W"],
      ["Close Window", "Shift+Command+W"],
    ],
  );
  const window = new FakeBrowserWindow();
  choose("New Tab", window, true);
  choose("Close Tab", window, true);
  assert.deepEqual(window.sent, [], "a ⌘T or ⌘W the window left unclaimed does nothing");
  assert.equal(window.closes, 0);
  choose("New Tab", window, false);
  choose("Close Tab", window, false);
  assert.deepEqual(window.sent, [
    [channels.onMenuCommand, APP_COMMAND.NEW_TAB],
    [channels.onMenuCommand, APP_COMMAND.CLOSE_TAB],
  ]);

  choose("Close Window", window, true);
  choose("Close Window", window, false);
  assert.equal(window.closes, 2);
  assert.equal(window.sent.length, 2, "Close Window hands the page nothing");
});
