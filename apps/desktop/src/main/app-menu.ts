/**
 * app-menu.ts -- the menu bar: the system's own menus, and the window's commands with their shortcuts beside them.
 *
 * A command item does nothing of its own. Its click hands the command to the
 * window it was chosen over, which runs it as its shortcut would and only
 * where it can run, so the menu holds no state to keep in step with the
 * window. The chord beside each item is the shortcut table's, so the menu
 * says the key the window answers; the window's keymap is what answers it.
 * What it does hold is the drawer's: the update item, the account's
 * experiments, and a development build's developer tools, each told on its
 * own clock, since a gated feature's items stand only while its experiment
 * is on.
 */

import { type ExperimentChoices, NO_EXPERIMENTS } from "@luke/settings";
import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import { type BaseWindow, BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { channels } from "#shared/bridge";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  type AppCommand,
  type KeyedCommand,
  MENU_COMMAND_LABELS,
  type MenuCommand,
  SHORTCUT_KEY,
  type ShortcutChord,
  shortcutAccelerator,
  shortcutShown,
} from "#shared/shortcuts";

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

/**
 * The developer tools' chord, ⌥⌘J, which opens Chrome's DevTools on its
 * console. Note that it is not ⌥⌘I, Chrome's other chord for them, because
 * Insert image holds ⌥⌘I, and a key reaching the menu runs the first item
 * that names it, which would be Edit's. It is no entry of the shortcut
 * table, since no window command answers it and the Keyboard shortcuts page
 * lists what every build offers.
 */
const DEVELOPER_TOOLS_CHORD: ShortcutChord = { key: SHORTCUT_KEY.J, option: true };

/** The update item's one act in each state, as the Updates row words it. */
export const UPDATE_MENU_ACT = {
  /** Ask for the latest build, with Settings brought forward, where the answer is drawn. */
  CHECK: "check",
  /** Nothing to choose: a check is already out. */
  CHECKING: "checking",
  /** Nothing to choose: a newer build is downloading itself. */
  DOWNLOADING: "downloading",
  /** Restart into the downloaded release. */
  RESTART: "restart",
  /** Open the latest release's page, for a build that cannot install one itself. */
  GET: "get",
} as const;

export type UpdateMenuAct = (typeof UPDATE_MENU_ACT)[keyof typeof UPDATE_MENU_ACT];

/**
 * The item's name for each act, in the title case a Mac menu writes. Note
 * that an act to choose carries no ellipsis, as no item in the bar does,
 * while the two that stand disabled say the work under way as a status does.
 */
const UPDATE_MENU_LABELS = {
  [UPDATE_MENU_ACT.CHECK]: "Check for Updates",
  [UPDATE_MENU_ACT.CHECKING]: "Checking for Updates…",
  [UPDATE_MENU_ACT.DOWNLOADING]: "Downloading Update…",
  [UPDATE_MENU_ACT.RESTART]: "Restart to Update",
  [UPDATE_MENU_ACT.GET]: "Download Latest Version",
} as const satisfies Record<UpdateMenuAct, string>;

/** What the app menu's update item does, and the presses it hands on. */
export interface UpdateMenu {
  act: UpdateMenuAct;
  onCheck: () => void;
  onInstall: () => void;
  onOpenLatest: () => void;
}

/**
 * What a development build's Developer menu reaches beyond the window chosen
 * over: the hidden voice window, which can never be chosen, and the call
 * window, too small to hold the tools docked.
 */
export interface DeveloperToolsMenu {
  onOpenVoiceWindow: () => void;
  onOpenCallWindow: () => void;
}

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
    // The command names its item, so the menu's gate can find a gated feature's item by it.
    id: command,
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

/** A command with no key, named as the window names it. */
function menuItem(command: MenuCommand): MenuItemConstructorOptions {
  return { label: menuTitle(MENU_COMMAND_LABELS[command]), click: sendCommand(command) };
}

/**
 * The update item's act for where the updater stands, or none for a
 * development build, which no release is newer than. A packaged build that
 * cannot install in place offers the releases page, as its Updates row does.
 */
export function updateMenuAct(
  update: UpdateSnapshot,
  packaged: boolean,
): UpdateMenuAct | undefined {
  if (!update.installSupported) return packaged ? UPDATE_MENU_ACT.GET : undefined;
  switch (update.status) {
    case UPDATE_STATUS.CHECKING:
      return UPDATE_MENU_ACT.CHECKING;
    case UPDATE_STATUS.DOWNLOADING:
      return UPDATE_MENU_ACT.DOWNLOADING;
    case UPDATE_STATUS.READY:
      return UPDATE_MENU_ACT.RESTART;
    default:
      return UPDATE_MENU_ACT.CHECK;
  }
}

/**
 * The app menu's update item, under About as a Mac app keeps it. Its presses
 * are main's own rather than the window's, because the menu stands while no
 * window does; a check brings the window forward on Settings itself
 * (`update-service-host.ts`), since a check that answers "nothing newer"
 * would otherwise say nothing at all.
 */
function updateItem(menu: UpdateMenu): MenuItemConstructorOptions {
  const label = UPDATE_MENU_LABELS[menu.act];
  switch (menu.act) {
    case UPDATE_MENU_ACT.CHECK:
      return { label, click: () => menu.onCheck() };
    case UPDATE_MENU_ACT.RESTART:
      return { label, click: () => menu.onInstall() };
    case UPDATE_MENU_ACT.GET:
      return { label, click: () => menu.onOpenLatest() };
    default:
      return { label, enabled: false };
  }
}

/**
 * View's Developer submenu: the window chosen over's own tools, toggled by
 * the system's role, docked as Chrome docks them, and the two windows it
 * cannot reach, whose tools open in a window of their own.
 */
function developerItem(tools: DeveloperToolsMenu): MenuItemConstructorOptions {
  return {
    label: "Developer",
    submenu: [
      {
        role: "toggleDevTools",
        label: "Developer Tools",
        accelerator: shortcutAccelerator(DEVELOPER_TOOLS_CHORD),
      },
      SEPARATOR,
      { label: "Voice Window Developer Tools", click: () => tools.onOpenVoiceWindow() },
      { label: "Call Window Developer Tools", click: () => tools.onOpenCallWindow() },
    ],
  };
}

/**
 * The menu bar, in the order a Mac app keeps it. Settings sits in the app's
 * own menu as macOS puts it, under the update item while there is one; the task's commands are File's, with New Tab,
 * Close Tab, and Close Window as Chrome's File keeps them, and Reopen Closed
 * Tab beside New Tab; Edit is the
 * system's own, spelt out so its Find submenu can hold the window's find as
 * every Mac app's Edit does; the window's
 * columns, the system's full screen, and its zoom are View's, the zoom in
 * the order Chrome's View keeps it, the call's microphone and speaker are
 * Call's, back and forward are Go's as Finder and Safari keep them, the
 * window's own are macOS's Window menu, and the shortcuts and the notes to
 * the people who make Luke are Help's. A gated feature's item stands only
 * while `shown` says its command does (`shortcutShown`), and View's
 * Developer submenu only where `developerTools` is given.
 */
export function appMenuTemplate(
  appName: string,
  update?: UpdateMenu,
  shown: (command: KeyedCommand) => boolean = () => true,
  developerTools?: DeveloperToolsMenu,
): MenuItemConstructorOptions[] {
  return gated(fullMenuTemplate(appName, update, developerTools), shown);
}

/** Whether a menu item is a command item the gate keeps out: one whose command does not stand now. */
function gatedOut(
  item: MenuItemConstructorOptions,
  shown: (command: KeyedCommand) => boolean,
): boolean {
  return item.id !== undefined && isKeyedCommandItem(item.id) && !shown(item.id);
}

function isKeyedCommandItem(id: string): id is KeyedCommand {
  return id in APP_SHORTCUTS;
}

/** A separator left with nothing to separate: first, last, or beside another. */
function strandedSeparator(items: readonly MenuItemConstructorOptions[], at: number): boolean {
  if (items[at]?.type !== "separator") return false;
  return at === 0 || at === items.length - 1 || items[at + 1]?.type === "separator";
}

/**
 * The menus with a gated feature's items taken out while its experiment is
 * off, every submenu walked, and a separator the removal stranded taken out
 * with them, so an off experiment leaves no gap where its item stood.
 */
function gated(
  items: readonly MenuItemConstructorOptions[],
  shown: (command: KeyedCommand) => boolean,
): MenuItemConstructorOptions[] {
  const kept = items
    .filter((item) => !gatedOut(item, shown))
    .map((item) =>
      Array.isArray(item.submenu) ? { ...item, submenu: gated(item.submenu, shown) } : item,
    );
  return kept.filter((_item, at) => !strandedSeparator(kept, at));
}

/** What the menu bar is drawn from: the update item, the experiments the account has on, and the developer tools. */
interface MenuBarState {
  readonly update: UpdateMenu | undefined;
  readonly experiments: ExperimentChoices;
  readonly developerTools: DeveloperToolsMenu | undefined;
}

/** One change to what the menu bar is drawn from: a new update item (or none), the account's experiments, or the windows' developer tools. */
export type MenuBarChange =
  | { readonly update: UpdateMenu | undefined }
  | { readonly experiments: ExperimentChoices }
  | { readonly developerTools: DeveloperToolsMenu };

/**
 * The menu bar's one drawer: it draws the menus from what it was last told,
 * and draws again only when a change moves them, since the updater and the
 * account's experiments each tell it on their own clocks and neither knows
 * the other's state. Called with nothing, it draws what it holds.
 *
 * Note that a packaged build never draws the developer tools, whoever tells
 * it of them: a build someone installed offers no way into a window's
 * insides, and the gate stands here, at the one drawer, so no caller has to
 * remember it.
 */
export function menuBarDrawer(
  build: { readonly appName: string; readonly packaged: boolean },
  draw: (template: MenuItemConstructorOptions[]) => void,
): (change?: MenuBarChange) => void {
  let state: MenuBarState = {
    update: undefined,
    experiments: NO_EXPERIMENTS,
    developerTools: undefined,
  };
  let drawn = false;
  return (change) => {
    const next = change === undefined ? state : { ...state, ...change };
    const moved =
      next.update !== state.update ||
      next.developerTools !== state.developerTools ||
      JSON.stringify(next.experiments) !== JSON.stringify(state.experiments);
    if (drawn && !moved) return;
    state = next;
    drawn = true;
    draw(
      appMenuTemplate(
        build.appName,
        state.update,
        (command) => shortcutShown(command, state.experiments),
        build.packaged ? undefined : state.developerTools,
      ),
    );
  };
}

/** Every menu and item, before the gate takes a gated feature's out. */
function fullMenuTemplate(
  appName: string,
  update?: UpdateMenu,
  developerTools?: DeveloperToolsMenu,
): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: "about" },
        ...(update ? [updateItem(update)] : []),
        SEPARATOR,
        commandItem(APP_COMMAND.SETTINGS),
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
        commandItem(APP_COMMAND.NEW_TASK),
        SEPARATOR,
        commandItem(APP_COMMAND.NEW_TAB),
        menuItem(APP_COMMAND.NEW_TERMINAL),
        commandItem(APP_COMMAND.REOPEN_CLOSED_TAB),
        closeTabItem(),
        closeWindowItem(),
        SEPARATOR,
        commandItem(APP_COMMAND.COPY_PLAN),
        commandItem(APP_COMMAND.COPY_LINK),
        SEPARATOR,
        commandItem(APP_COMMAND.ARCHIVE_TASK),
        commandItem(APP_COMMAND.DELETE_TASK),
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
            commandItem(APP_COMMAND.FIND),
            commandItem(APP_COMMAND.FIND_NEXT),
            commandItem(APP_COMMAND.FIND_PREVIOUS),
          ],
        },
        SEPARATOR,
        commandItem(APP_COMMAND.MENTION_LINES),
        commandItem(APP_COMMAND.INSERT_PICTURE),
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
        commandItem(APP_COMMAND.SHOW_TERMINAL),
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
        commandItem(APP_COMMAND.PREVIOUS_TASK),
        commandItem(APP_COMMAND.NEXT_TASK),
        ...(developerTools ? [SEPARATOR, developerItem(developerTools)] : []),
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
        commandItem(APP_COMMAND.HOME),
        commandItem(APP_COMMAND.INBOX),
        commandItem(APP_COMMAND.ISSUES),
        commandItem(APP_COMMAND.AUTOMATIONS),
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
        menuItem(APP_COMMAND.SEND_FEEDBACK),
        menuItem(APP_COMMAND.SUGGEST_FEATURE),
      ],
    },
  ];
}
