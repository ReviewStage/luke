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

function commandItem(command: AppCommand): MenuItemConstructorOptions {
  const shortcut = APP_SHORTCUTS[command];
  return {
    label: menuTitle(shortcut.label),
    accelerator: shortcutAccelerator(shortcut.chord),
    click: (_item, window: BaseWindow | undefined, event) => {
      // Note that a key reaching the menu is one the window chose not to
      // claim: nothing offered its command, a text field kept its own ⌘⌫,
      // or it was the window's layered Escape. The keymap is the one reader
      // of keys, so only a click runs an item.
      if (event.triggeredByAccelerator) return;
      // The window arrives as the base type, and only a browser window has a
      // page to hand the command to.
      if (window instanceof BrowserWindow) window.webContents.send(channels.onMenuCommand, command);
    },
  };
}

/**
 * The menu bar, in the order a Mac app keeps it. Settings sits in the app's
 * own menu as macOS puts it; the plan's commands are File's, the window's
 * columns are View's, and the shortcuts are Help's.
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
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        SEPARATOR,
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        commandItem(APP_COMMAND.NEW_PLAN),
        SEPARATOR,
        commandItem(APP_COMMAND.COPY_PLAN),
        commandItem(APP_COMMAND.REVEAL_FOLDER),
        SEPARATOR,
        commandItem(APP_COMMAND.DELETE_PLAN),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        commandItem(APP_COMMAND.TOGGLE_SIDEBAR),
        commandItem(APP_COMMAND.TOGGLE_SIDE_PANEL),
        commandItem(APP_COMMAND.TOGGLE_FULL_SCREEN),
        commandItem(APP_COMMAND.EXIT_FULL_SCREEN),
        SEPARATOR,
        commandItem(APP_COMMAND.SHOW_BOARD),
        commandItem(APP_COMMAND.SHOW_CODE),
        commandItem(APP_COMMAND.SHOW_TRANSCRIPT),
        SEPARATOR,
        commandItem(APP_COMMAND.PREVIOUS_PLAN),
        commandItem(APP_COMMAND.NEXT_PLAN),
      ],
    },
    { role: "windowMenu" },
    { role: "help", submenu: [commandItem(APP_COMMAND.KEYBOARD_SHORTCUTS)] },
  ];
}
