import assert from "node:assert/strict";
import type { MenuItemConstructorOptions } from "electron";
import { test, vi } from "vitest";
import { channels } from "#shared/bridge";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  KEYED_COMMANDS,
  type ShortcutChord,
  shortcutAccelerator,
  shortcutLayered,
} from "#shared/shortcuts";
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

/** Every item in the menu bar, the menus' own items under them. */
function everyItem(): MenuItemConstructorOptions[] {
  const under = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
    items.flatMap((each) => [each, ...(Array.isArray(each.submenu) ? under(each.submenu) : [])]);
  return under(appMenuTemplate("Luke"));
}

function item(label: string): MenuItemConstructorOptions {
  const found = everyItem().find((each) => each.label === label);
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
  choose("Exit Panel Full Screen", window, true);
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

test("File's New Tab and Close Tab hand the window their commands on a click, ⌘T is left to the window's keymap, a ⌘W with no tab to close closes the window, and Close Window closes it on ⇧⌘W or a click", () => {
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
  assert.deepEqual(window.sent, [], "a ⌘T the window left unclaimed does nothing");
  assert.equal(window.closes, 0);
  choose("Close Tab", window, true);
  assert.equal(window.closes, 1, "a ⌘W the window had no tab for closes the window");
  assert.deepEqual(window.sent, []);
  choose("New Tab", window, false);
  choose("Close Tab", window, false);
  assert.deepEqual(window.sent, [
    [channels.onMenuCommand, APP_COMMAND.NEW_TAB],
    [channels.onMenuCommand, APP_COMMAND.CLOSE_TAB],
  ]);
  assert.equal(window.closes, 1, "a click on Close Tab is the window's to answer");

  choose("Close Window", window, true);
  choose("Close Window", window, false);
  assert.equal(window.closes, 3);
  assert.equal(window.sent.length, 2, "Close Window hands the page nothing");
});

test("View holds Actual Size, Zoom In, and Zoom Out as Chrome orders them, each handed to the window it was chosen over", () => {
  const view = appMenuTemplate("Luke").find((menu) => menu.label === "View");
  assert.ok(Array.isArray(view?.submenu));
  assert.deepEqual(
    view.submenu
      .filter((each) => each.label === "Actual Size" || each.label?.startsWith("Zoom"))
      .map((each) => [each.label, each.accelerator]),
    [
      ["Actual Size", "Command+0"],
      ["Zoom In", "Command+Plus"],
      ["Zoom Out", "Command+-"],
    ],
  );
  const window = new FakeBrowserWindow();
  choose("Zoom In", window, true);
  assert.deepEqual(
    window.sent,
    [],
    "a ⌘+ the window left unclaimed, at the largest size, does nothing",
  );
  choose("Zoom In", window, false);
  choose("Zoom Out", window, false);
  choose("Actual Size", window, false);
  assert.deepEqual(window.sent, [
    [channels.onMenuCommand, APP_COMMAND.ZOOM_IN],
    [channels.onMenuCommand, APP_COMMAND.ZOOM_OUT],
    [channels.onMenuCommand, APP_COMMAND.ACTUAL_SIZE],
  ]);
});

test("the system's own items answer the chords the shortcuts page lists: Hide, Hide Others, Quit, Minimize, and Toggle Full Screen", () => {
  const chords = new Map(
    everyItem().flatMap((each) => (each.role ? [[each.role, each.accelerator]] : [])),
  );
  assert.equal(chords.get("hide"), "Command+H");
  assert.equal(chords.get("hideOthers"), "Alt+Command+H");
  assert.equal(chords.get("quit"), "Command+Q");
  assert.equal(chords.get("minimize"), "Command+M");
  assert.equal(chords.get("togglefullscreen"), "Control+Command+F");
  assert.ok(chords.has("windowMenu"), "the Window menu is macOS's own");
  assert.ok(chords.has("help"), "the Help menu is macOS's own, with its search");
});

test("no chord is bound twice: not across the menu bar, not by the shortcut table, and not over the Edit menu's own", () => {
  // The Edit menu's roles bring these, unseen in the template.
  const editing = [
    "Command+Z",
    "Shift+Command+Z",
    "Command+X",
    "Command+C",
    "Command+V",
    "Alt+Shift+Command+V",
    "Command+A",
  ];
  const menu = everyItem().flatMap((each) =>
    each.accelerator === undefined ? [] : [String(each.accelerator)],
  );
  const bound = [...menu, ...editing];
  assert.deepEqual(
    bound.filter((chord, index) => bound.indexOf(chord) !== index),
    [],
  );
  // The window's layered Escape is the one chord several commands share.
  const table = KEYED_COMMANDS.map((command): ShortcutChord => APP_SHORTCUTS[command].chord)
    .filter((chord) => !shortcutLayered(chord))
    .map(shortcutAccelerator);
  const owned = [...table, ...editing];
  assert.deepEqual(
    owned.filter((chord, index) => owned.indexOf(chord) !== index),
    [],
  );
  for (const chord of menu) assert.ok(table.includes(chord) || chord === "Escape", chord);
});

test("Edit keeps the system's own items and holds Find as every Mac app's does, Find…, Find Next, and Find Previous each handed to the window on a click and their keys left to the window's keymap", () => {
  const edit = appMenuTemplate("Luke").find((menu) => menu.label === "Edit");
  assert.ok(Array.isArray(edit?.submenu));
  assert.deepEqual(
    edit.submenu.flatMap((each) => (each.role === undefined ? [] : [each.role])),
    ["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll"],
  );
  const find = edit.submenu.find((each) => each.label === "Find");
  assert.ok(Array.isArray(find?.submenu));
  assert.deepEqual(
    find.submenu.map((each) => [each.label, each.accelerator]),
    [
      ["Find…", "Command+F"],
      ["Find Next", "Command+G"],
      ["Find Previous", "Shift+Command+G"],
    ],
  );
  const window = new FakeBrowserWindow();
  for (const label of ["Find…", "Find Next", "Find Previous"]) {
    choose(label, window, true);
    choose(label, window, false);
  }
  assert.deepEqual(window.sent, [
    [channels.onMenuCommand, APP_COMMAND.FIND],
    [channels.onMenuCommand, APP_COMMAND.FIND_NEXT],
    [channels.onMenuCommand, APP_COMMAND.FIND_PREVIOUS],
  ]);
});
