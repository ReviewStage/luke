/**
 * app-menu.ts -- the menu bar: the system's own menus, and the window's commands with their shortcuts beside them.
 *
 * A command item does nothing of its own. Its click hands the command to the
 * window it was chosen over, which runs it as its shortcut would and only
 * where it can run, so the menu holds no state to keep in step with the
 * window. The chord beside each item is the shortcut table's, so the menu
 * says the key the window answers; the window's keymap is what answers it.
 */

import { type BaseWindow, BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { channels } from "#shared/bridge";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  type AppCommand,
  type KeyedCommand,
  MENU_COMMAND_LABELS,
  type MenuCommand,
  shortcutAccelerator,
} from "#shared/shortcuts";

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

/** The short words a title leaves lower case after its first. */
const TITLE_LOWER_WORDS = new Set(["a", "and", "in", "of", "or", "the", "to"]);

/** The window's sentence-case name, in the title case a Mac menu writes its items in. */
function menuTitle(label: string): string {
  return label
    .split(" ")
    .map((word, index) =>
      index > 0 && TITLE_LOWER_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/** Hands a chosen item's command to the window it was chosen over. */
function sendCommand(command: AppCommand): NonNullable<MenuItemConstructorOptions["click"]> {
  return (_item, window: BaseWindow | undefined, event) => {
    // Note that a key reaching the menu is one the window chose not to
    // claim: nothing offered its command, a text field kept its own ⌘⌫,
    // or it was the window's layered Escape. The keymap is the one reader
    // of keys, so only a click runs an item.
    if (event.triggeredByAccelerator) return;
    // The window arrives as the base type, and only a browser window has a
    // page to hand the command to.
    if (window instanceof BrowserWindow) window.webContents.send(channels.onMenuCommand, command);
  };
}

function commandItem(command: KeyedCommand): MenuItemConstructorOptions {
  const shortcut = APP_SHORTCUTS[command];
  return {
    label: menuTitle(shortcut.label),
    accelerator: shortcutAccelerator(shortcut.chord),
    click: sendCommand(command),
  };
}

/**
 * Close Window, which main runs itself rather than handing the window: it
 * closes the window chosen over, which hides it as every close does
 * (`panel-manager.ts`). Note that its key runs it too, unlike a command
 * item's, because the window's keymap claims no ⇧⌘W, so a key reaching it
 * is the one press it will see; ⌘W is the window's own, closing its tab.
 */
function closeWindowItem(): MenuItemConstructorOptions {
  const shortcut = APP_SHORTCUTS[APP_COMMAND.CLOSE_WINDOW];
  return {
    label: menuTitle(shortcut.label),
    accelerator: shortcutAccelerator(shortcut.chord),
    click: (_item, window: BaseWindow | undefined) => window?.close(),
  };
}

/**
 * Close Tab, handed to the window on a click as any command is. Note that a
 * ⌘W reaching the menu is one the window had no tab to close for, so it
 * closes the window instead, as Safari and Chrome close a window with its
 * last tab.
 */
function closeTabItem(): MenuItemConstructorOptions {
  const handOn = sendCommand(APP_COMMAND.CLOSE_TAB);
  return {
    ...commandItem(APP_COMMAND.CLOSE_TAB),
    click: (item, window: BaseWindow | undefined, event) => {
      if (event.triggeredByAccelerator) window?.close();
      else handOn(item, window, event);
    },
  };
}

/** One of the system's own items, answering the chord the shortcut table gives it. */
function roleItem(
  role: NonNullable<MenuItemConstructorOptions["role"]>,
  command: KeyedCommand,
): MenuItemConstructorOptions {
  return { role, accelerator: shortcutAccelerator(APP_SHORTCUTS[command].chord) };
}

/** A command with no key: named with an ellipsis, as an item that opens a dialog is. */
function dialogItem(command: MenuCommand): MenuItemConstructorOptions {
  return { label: `${menuTitle(MENU_COMMAND_LABELS[command])}…`, click: sendCommand(command) };
}

/**
 * The menu bar, in the order a Mac app keeps it. Settings sits in the app's
 * own menu as macOS puts it; the plan's commands are File's, with New Tab,
 * Reopen Closed Tab, Close Tab, and Close Window as Chrome's File keeps
 * them; Edit is the system's own, spelt out so its Find submenu can hold
 * the window's find as every Mac app's Edit does; the window's columns, the system's full screen, and its zoom are View's, the zoom in
 * the order Chrome's View keeps it, the call's microphone and speaker are
 * Call's, back and forward are Go's as Finder and Safari keep them, the
 * window's own are macOS's Window menu, and the shortcuts and the notes to
 * the people who make Luke are Help's.
 */
export function appMenuTemplate(appName: string): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: "about" },
        SEPARATOR,
        // A Mac app's own menu names Settings with an ellipsis, as a window
        // it opens.
        { ...commandItem(APP_COMMAND.SETTINGS), label: "Settings…" },
        SEPARATOR,
        { role: "services" },
        SEPARATOR,
        roleItem("hide", APP_COMMAND.HIDE),
        roleItem("hideOthers", APP_COMMAND.HIDE_OTHERS),
        { role: "unhide" },
        SEPARATOR,
        roleItem("quit", APP_COMMAND.QUIT),
      ],
    },
    {
      label: "File",
      submenu: [
        commandItem(APP_COMMAND.NEW_PLAN),
        SEPARATOR,
        commandItem(APP_COMMAND.NEW_TAB),
        commandItem(APP_COMMAND.REOPEN_CLOSED_TAB),
        closeTabItem(),
        closeWindowItem(),
        SEPARATOR,
        commandItem(APP_COMMAND.COPY_PLAN),
        SEPARATOR,
        commandItem(APP_COMMAND.ARCHIVE_PLAN),
        commandItem(APP_COMMAND.DELETE_PLAN),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        SEPARATOR,
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        SEPARATOR,
        {
          label: "Find",
          submenu: [
            // Find opens a bar, so it is named with an ellipsis, as a Mac app's Find… is.
            { ...commandItem(APP_COMMAND.FIND), label: "Find…" },
            commandItem(APP_COMMAND.FIND_NEXT),
            commandItem(APP_COMMAND.FIND_PREVIOUS),
          ],
        },
        SEPARATOR,
        {
          label: "Speech",
          submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
        },
      ],
    },
    {
      label: "View",
      submenu: [
        commandItem(APP_COMMAND.TOGGLE_SIDEBAR),
        commandItem(APP_COMMAND.TOGGLE_SIDE_PANEL),
        commandItem(APP_COMMAND.TOGGLE_FULL_SCREEN),
        commandItem(APP_COMMAND.EXIT_FULL_SCREEN),
        SEPARATOR,
        roleItem("togglefullscreen", APP_COMMAND.FULL_SCREEN),
        SEPARATOR,
        commandItem(APP_COMMAND.ACTUAL_SIZE),
        // "In" is a particle here rather than the preposition a title leaves
        // lower case, so the item reads as every Mac app's Zoom In.
        { ...commandItem(APP_COMMAND.ZOOM_IN), label: "Zoom In" },
        commandItem(APP_COMMAND.ZOOM_OUT),
        SEPARATOR,
        commandItem(APP_COMMAND.PREVIOUS_PLAN),
        commandItem(APP_COMMAND.NEXT_PLAN),
      ],
    },
    {
      label: "Call",
      submenu: [
        commandItem(APP_COMMAND.TOGGLE_MICROPHONE),
        commandItem(APP_COMMAND.TOGGLE_SPEAKER),
      ],
    },
    {
      label: "Go",
      submenu: [
        commandItem(APP_COMMAND.INBOX),
        SEPARATOR,
        commandItem(APP_COMMAND.BACK),
        commandItem(APP_COMMAND.FORWARD),
      ],
    },
    {
      // The role makes this macOS's own Window menu, which adds the window
      // list and, on macOS 15, its tiling items; ⌘` cycles the windows.
      role: "windowMenu",
      submenu: [
        roleItem("minimize", APP_COMMAND.MINIMIZE),
        { role: "zoom" },
        SEPARATOR,
        { role: "front" },
      ],
    },
    {
      role: "help",
      submenu: [
        commandItem(APP_COMMAND.KEYBOARD_SHORTCUTS),
        SEPARATOR,
        dialogItem(APP_COMMAND.SEND_FEEDBACK),
        dialogItem(APP_COMMAND.SUGGEST_FEATURE),
      ],
    },
  ];
}
