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

import { PUSH } from "@luke/host/contract";
import { type ExperimentChoices, type HostCapability, NO_EXPERIMENTS } from "@luke/settings";
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
  shortcutLabel,
  shortcutShown,
} from "@luke/settings/shortcuts";
import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import { type BaseWindow, BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { windowPushes } from "./window/window-pushes";

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
 * that an act to choose carries no ellipsis, since it opens nothing and asks
 * nothing, while the two that stand disabled say the work under way as a
 * status does.
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

/**
 * What the menu reaches of the panel window beyond the window chosen over:
 * whether that window is the panel, and the panel brought back, for a
 * command chosen while it stands closed or behind another of Luke's windows.
 */
export interface PanelMenu {
  isPanel: (window: BaseWindow) => boolean;
  onReopen: (command: AppCommand) => void;
}

/** What the menu's Reload hands main: the window chosen over, to reload once nothing its page holds would be lost. */
export interface ReloadMenu {
  onReload: (window: BaseWindow) => void;
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
    if (window instanceof BrowserWindow) {
      windowPushes.push(window.webContents, PUSH.MENU_COMMAND, command);
    }
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

/**
 * New Task, handed to the panel on a click as any command is while the
 * panel is in front. Note that with it closed, its key runs it too, unlike
 * a command item's: no window's keymap stands to answer ⌘N then, so the
 * press brings the window back on a new task, as a Mac app's ⌘N opens a
 * window when none is open.
 */
function newTaskItem(panel: PanelMenu | undefined): MenuItemConstructorOptions {
  const handOn = sendCommand(APP_COMMAND.NEW_TASK);
  return {
    ...commandItem(APP_COMMAND.NEW_TASK),
    click: (item, window: BaseWindow | undefined, event) => {
      if (panel === undefined || (window !== undefined && panel.isPanel(window))) {
        handOn(item, window, event);
      } else {
        panel.onReopen(APP_COMMAND.NEW_TASK);
      }
    },
  };
}

/**
 * Reload, which main runs itself rather than handing the window, on its key
 * as on a click, since no window's keymap claims ⌘R. It reloads the window
 * chosen over, the panel or the call card, once `reload` has asked about
 * edits the page would lose; the system's own reload stands until it is
 * told, while no page has loaded to hold any.
 */
function reloadItem(reload: ReloadMenu | undefined): MenuItemConstructorOptions {
  if (reload === undefined) return roleItem("reload", APP_COMMAND.RELOAD);
  const shortcut = APP_SHORTCUTS[APP_COMMAND.RELOAD];
  return {
    label: menuTitle(shortcut.label),
    accelerator: shortcutAccelerator(shortcut.chord),
    click: (_item, window: BaseWindow | undefined) => {
      if (window !== undefined) reload.onReload(window);
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

/**
 * An item that opens a window or asks before it acts, named with the "…" a
 * Mac menu gives such an item. Note that the ellipsis belongs to the menu
 * bar alone: ⌘K and the shortcuts page name the same commands bare, so it is
 * added here and not to their shared labels.
 */
function opening(item: MenuItemConstructorOptions): MenuItemConstructorOptions {
  return { ...item, label: `${item.label}…` };
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
 * every Mac app's Edit does; the system's reload, the window's
 * columns, the system's full screen, and its zoom are View's, reload first
 * as Safari's View keeps it, the zoom in
 * the order Chrome's View keeps it, the call's microphone and speaker are
 * Call's, the command palette, the places, back and forward (as Finder and
 * Safari keep them) and the tab moves are Go's, the
 * window's own are macOS's Window menu, and the shortcuts and the notes to
 * the people who make Luke are Help's. A gated feature's item stands only
 * while `shown` says its command does (`shortcutShown`), a command item is
 * called what `named` says, which an experiment may rename (`shortcutLabel`), and View's
 * Developer submenu only where `developerTools` is given. New Task brings a
 * closed window back only where `panel` is given, and Reload asks before it
 * loses unsaved edits only where `reload` is.
 */
export function appMenuTemplate(
  appName: string,
  update?: UpdateMenu,
  shown: (command: KeyedCommand) => boolean = () => true,
  developerTools?: DeveloperToolsMenu,
  panel?: PanelMenu,
  reload?: ReloadMenu,
  named: (command: KeyedCommand) => string = (command) => APP_SHORTCUTS[command].label,
): MenuItemConstructorOptions[] {
  return gated(fullMenuTemplate(appName, update, developerTools, panel, reload), shown, named);
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

/** A command item called what `named` says where that is not its own name, as an experiment renames one. */
function renamedItem(
  item: MenuItemConstructorOptions,
  named: (command: KeyedCommand) => string,
): MenuItemConstructorOptions {
  if (item.id === undefined || !isKeyedCommandItem(item.id)) return item;
  const label = named(item.id);
  return label === APP_SHORTCUTS[item.id].label ? item : { ...item, label: menuTitle(label) };
}

/**
 * The menus with a gated feature's items taken out while its experiment is
 * off, every submenu walked, and a separator the removal stranded taken out
 * with them, so an off experiment leaves no gap where its item stood; and a
 * command item an experiment renames called as it says.
 */
function gated(
  items: readonly MenuItemConstructorOptions[],
  shown: (command: KeyedCommand) => boolean,
  named: (command: KeyedCommand) => string,
): MenuItemConstructorOptions[] {
  const kept = items
    .filter((item) => !gatedOut(item, shown))
    .map((item) =>
      Array.isArray(item.submenu)
        ? { ...item, submenu: gated(item.submenu, shown, named) }
        : renamedItem(item, named),
    );
  return kept.filter((_item, at) => !strandedSeparator(kept, at));
}

/** What the menu bar is drawn from: the update item, the experiments the account has on, what the platform offers, the developer tools, the panel window, and the reload. */
interface MenuBarState {
  readonly update: UpdateMenu | undefined;
  readonly experiments: ExperimentChoices;
  readonly capabilities: readonly HostCapability[];
  readonly developerTools: DeveloperToolsMenu | undefined;
  readonly panel: PanelMenu | undefined;
  readonly reload: ReloadMenu | undefined;
}

/** One change to what the menu bar is drawn from: a new update item (or none), the account's experiments and the platform's capabilities as the document carries them, the windows' developer tools, the panel window, or the reload. */
export type MenuBarChange =
  | { readonly update: UpdateMenu | undefined }
  | {
      readonly experiments: ExperimentChoices;
      readonly capabilities: readonly HostCapability[];
    }
  | { readonly developerTools: DeveloperToolsMenu }
  | { readonly panel: PanelMenu }
  | { readonly reload: ReloadMenu };

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
    capabilities: [],
    developerTools: undefined,
    panel: undefined,
    reload: undefined,
  };
  let drawn = false;
  return (change) => {
    const next = change === undefined ? state : { ...state, ...change };
    const moved =
      next.update !== state.update ||
      next.developerTools !== state.developerTools ||
      next.panel !== state.panel ||
      next.reload !== state.reload ||
      JSON.stringify(next.experiments) !== JSON.stringify(state.experiments) ||
      JSON.stringify(next.capabilities) !== JSON.stringify(state.capabilities);
    if (drawn && !moved) return;
    state = next;
    drawn = true;
    draw(
      appMenuTemplate(
        build.appName,
        state.update,
        (command) => shortcutShown(command, state.experiments, state.capabilities),
        build.packaged ? undefined : state.developerTools,
        state.panel,
        state.reload,
        (command) => shortcutLabel(command, state.experiments),
      ),
    );
  };
}

/** Every menu and item, before the gate takes a gated feature's out. */
function fullMenuTemplate(
  appName: string,
  update?: UpdateMenu,
  developerTools?: DeveloperToolsMenu,
  panel?: PanelMenu,
  reload?: ReloadMenu,
): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: "about" },
        ...(update ? [updateItem(update)] : []),
        SEPARATOR,
        opening(commandItem(APP_COMMAND.SETTINGS)),
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
        newTaskItem(panel),
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
        commandItem(APP_COMMAND.MARK_TASK_DONE),
        opening(commandItem(APP_COMMAND.DELETE_TASK)),
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
        commandItem(APP_COMMAND.COMMENT_ON_SELECTION),
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
        // Note that the window chosen over is never the hidden voice window,
        // which takes no focus, so a reload leaves a standing call up
        // (`voice-window.ts`).
        reloadItem(reload),
        SEPARATOR,
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
        commandItem(APP_COMMAND.COMMAND_PALETTE),
        SEPARATOR,
        commandItem(APP_COMMAND.ASK_LUKE),
        commandItem(APP_COMMAND.INBOX),
        commandItem(APP_COMMAND.TASKS),
        commandItem(APP_COMMAND.AUTOMATIONS),
        SEPARATOR,
        commandItem(APP_COMMAND.BACK),
        commandItem(APP_COMMAND.FORWARD),
        SEPARATOR,
        commandItem(APP_COMMAND.NEXT_RECENT_TAB),
        commandItem(APP_COMMAND.PREVIOUS_RECENT_TAB),
        SEPARATOR,
        commandItem(APP_COMMAND.MOVE_TAB_LEFT),
        commandItem(APP_COMMAND.MOVE_TAB_RIGHT),
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
        opening(menuItem(APP_COMMAND.SEND_FEEDBACK)),
        opening(menuItem(APP_COMMAND.SUGGEST_FEATURE)),
      ],
    },
  ];
}
