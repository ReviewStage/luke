import { PUSH } from "@repo/host/contract";
import { type ExperimentChoices, type HostCapability, NO_EXPERIMENTS } from "@repo/settings";
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
} from "@repo/settings/shortcuts";
import { UPDATE_STATUS, type UpdateSnapshot } from "@repo/settings/update";
import { type BaseWindow, BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { windowPushes } from "./window/window-pushes";

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

const DEVELOPER_TOOLS_CHORD: ShortcutChord = { key: SHORTCUT_KEY.J, option: true };

export const UPDATE_MENU_ACT = {
  CHECK: "check",
  CHECKING: "checking",
  DOWNLOADING: "downloading",
  RESTART: "restart",
  GET: "get",
} as const;

export type UpdateMenuAct = (typeof UPDATE_MENU_ACT)[keyof typeof UPDATE_MENU_ACT];

const UPDATE_MENU_LABELS = {
  [UPDATE_MENU_ACT.CHECK]: "Check for Updates",
  [UPDATE_MENU_ACT.CHECKING]: "Checking for Updates…",
  [UPDATE_MENU_ACT.DOWNLOADING]: "Downloading Update…",
  [UPDATE_MENU_ACT.RESTART]: "Restart to Update",
  [UPDATE_MENU_ACT.GET]: "Download Latest Version",
} as const satisfies Record<UpdateMenuAct, string>;

export interface UpdateMenu {
  act: UpdateMenuAct;
  onCheck: () => void;
  onInstall: () => void;
  onOpenLatest: () => void;
}

export interface PanelMenu {
  isPanel: (window: BaseWindow) => boolean;
  onReopen: (command?: AppCommand) => void;
}

export interface ReloadMenu {
  onReload: (window: BaseWindow) => void;
}

export interface BuildLabelMenu {
  shown: boolean;
  onShow: (shown: boolean) => void;
}

const TITLE_LOWER_WORDS = new Set(["a", "and", "in", "of", "on", "or", "the", "to"]);

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

const HANDED = new WeakMap<NonNullable<MenuItemConstructorOptions["click"]>, AppCommand>();

function sendCommand(command: AppCommand): NonNullable<MenuItemConstructorOptions["click"]> {
  const hand: NonNullable<MenuItemConstructorOptions["click"]> = (
    _item,
    window: BaseWindow | undefined,
    event,
  ) => {
    if (event.triggeredByAccelerator) return;
    if (window instanceof BrowserWindow) {
      windowPushes.push(window.webContents, PUSH.MENU_COMMAND, command);
    }
  };
  HANDED.set(hand, command);
  return hand;
}

function commandItem(command: KeyedCommand): MenuItemConstructorOptions {
  const shortcut = APP_SHORTCUTS[command];
  return {
    id: command,
    label: menuTitle(shortcut.label),
    accelerator: shortcutAccelerator(shortcut.chord),
    click: sendCommand(command),
  };
}

function closeWindowItem(): MenuItemConstructorOptions {
  const shortcut = APP_SHORTCUTS[APP_COMMAND.CLOSE_WINDOW];
  return {
    label: menuTitle(shortcut.label),
    accelerator: shortcutAccelerator(shortcut.chord),
    click: (_item, window: BaseWindow | undefined) => window?.close(),
  };
}

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

function actualSizeItem(panel: PanelMenu | undefined): MenuItemConstructorOptions {
  const handOn = sendCommand(APP_COMMAND.ACTUAL_SIZE);
  return {
    ...commandItem(APP_COMMAND.ACTUAL_SIZE),
    click: (item, window: BaseWindow | undefined, event) => {
      const panelInFront = window !== undefined && panel?.isPanel(window) === true;
      if (panel !== undefined && event.triggeredByAccelerator && !panelInFront) panel.onReopen();
      else handOn(item, window, event);
    },
  };
}

function mainWindowItem(appName: string, panel: PanelMenu): MenuItemConstructorOptions {
  return {
    label: appName,
    accelerator: shortcutAccelerator(APP_SHORTCUTS[APP_COMMAND.ACTUAL_SIZE].chord),
    click: () => panel.onReopen(),
  };
}

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

function roleItem(
  role: NonNullable<MenuItemConstructorOptions["role"]>,
  command: KeyedCommand,
): MenuItemConstructorOptions {
  return { role, accelerator: shortcutAccelerator(APP_SHORTCUTS[command].chord) };
}

function opening(item: MenuItemConstructorOptions): MenuItemConstructorOptions {
  return { ...item, label: `${item.label}…` };
}

function menuItem(command: MenuCommand): MenuItemConstructorOptions {
  return { label: menuTitle(MENU_COMMAND_LABELS[command]), click: sendCommand(command) };
}

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

function developerItem(buildLabel: BuildLabelMenu | undefined): MenuItemConstructorOptions {
  const tools: MenuItemConstructorOptions = {
    role: "toggleDevTools",
    label: "Developer Tools",
    accelerator: shortcutAccelerator(DEVELOPER_TOOLS_CHORD),
  };
  if (buildLabel === undefined) return { label: "Developer", submenu: [tools] };
  const label: MenuItemConstructorOptions = {
    type: "checkbox",
    label: "Show Build Label",
    checked: buildLabel.shown,
    click: () => buildLabel.onShow(!buildLabel.shown),
  };
  return { label: "Developer", submenu: [tools, SEPARATOR, label] };
}

export function appMenuTemplate(
  appName: string,
  update?: UpdateMenu,
  shown: (command: KeyedCommand) => boolean = () => true,
  developerTools = false,
  panel?: PanelMenu,
  reload?: ReloadMenu,
  named: (command: KeyedCommand) => string = (command) => APP_SHORTCUTS[command].label,
  buildLabel?: BuildLabelMenu,
  offered: (command: AppCommand) => boolean = () => true,
): MenuItemConstructorOptions[] {
  return gated(
    fullMenuTemplate(appName, update, developerTools, panel, reload, buildLabel),
    shown,
    named,
    offered,
  );
}

function offeredBy(commands: readonly AppCommand[] | undefined): (command: AppCommand) => boolean {
  if (commands === undefined) return () => true;
  const held = new Set(commands);
  return (command) => held.has(command);
}

function dimmedItem(
  item: MenuItemConstructorOptions,
  offered: (command: AppCommand) => boolean,
): MenuItemConstructorOptions {
  const handed = item.click === undefined ? undefined : HANDED.get(item.click);
  return handed === undefined || offered(handed) ? item : { ...item, enabled: false };
}

function gatedOut(
  item: MenuItemConstructorOptions,
  shown: (command: KeyedCommand) => boolean,
): boolean {
  return item.id !== undefined && isKeyedCommandItem(item.id) && !shown(item.id);
}

function isKeyedCommandItem(id: string): id is KeyedCommand {
  return id in APP_SHORTCUTS;
}

function strandedSeparator(items: readonly MenuItemConstructorOptions[], at: number): boolean {
  if (items[at]?.type !== "separator") return false;
  return at === 0 || at === items.length - 1 || items[at + 1]?.type === "separator";
}

function renamedItem(
  item: MenuItemConstructorOptions,
  named: (command: KeyedCommand) => string,
): MenuItemConstructorOptions {
  if (item.id === undefined || !isKeyedCommandItem(item.id)) return item;
  const label = named(item.id);
  return label === APP_SHORTCUTS[item.id].label ? item : { ...item, label: menuTitle(label) };
}

function gated(
  items: readonly MenuItemConstructorOptions[],
  shown: (command: KeyedCommand) => boolean,
  named: (command: KeyedCommand) => string,
  offered: (command: AppCommand) => boolean,
): MenuItemConstructorOptions[] {
  const kept = items
    .filter((item) => !gatedOut(item, shown))
    .map((item) =>
      Array.isArray(item.submenu)
        ? { ...item, submenu: gated(item.submenu, shown, named, offered) }
        : dimmedItem(renamedItem(item, named), offered),
    );
  return kept.filter((_item, at) => !strandedSeparator(kept, at));
}

interface MenuBarState {
  readonly update: UpdateMenu | undefined;
  readonly experiments: ExperimentChoices;
  readonly capabilities: readonly HostCapability[];
  readonly developerTools: boolean;
  readonly panel: PanelMenu | undefined;
  readonly reload: ReloadMenu | undefined;
  readonly buildLabel: BuildLabelMenu | undefined;
  readonly offered: readonly AppCommand[] | undefined;
}

export type MenuBarChange =
  | { readonly update: UpdateMenu | undefined }
  | {
      readonly experiments: ExperimentChoices;
      readonly capabilities: readonly HostCapability[];
    }
  | { readonly developerTools: boolean }
  | { readonly panel: PanelMenu }
  | { readonly reload: ReloadMenu }
  | { readonly buildLabel: BuildLabelMenu }
  | { readonly offered: readonly AppCommand[] | undefined };

export function menuBarDrawer(
  build: { readonly appName: string; readonly packaged: boolean },
  draw: (template: MenuItemConstructorOptions[]) => void,
): (change?: MenuBarChange) => void {
  let state: MenuBarState = {
    update: undefined,
    experiments: NO_EXPERIMENTS,
    capabilities: [],
    developerTools: false,
    panel: undefined,
    reload: undefined,
    buildLabel: undefined,
    offered: undefined,
  };
  let drawn = false;
  return (change) => {
    const next = change === undefined ? state : { ...state, ...change };
    const moved =
      next.update !== state.update ||
      next.developerTools !== state.developerTools ||
      next.panel !== state.panel ||
      next.reload !== state.reload ||
      next.buildLabel !== state.buildLabel ||
      next.offered?.join() !== state.offered?.join() ||
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
        !build.packaged && state.developerTools,
        state.panel,
        state.reload,
        (command) => shortcutLabel(command, state.experiments),
        state.buildLabel,
        offeredBy(state.offered),
      ),
    );
  };
}

function fullMenuTemplate(
  appName: string,
  update: UpdateMenu | undefined,
  developerTools: boolean,
  panel?: PanelMenu,
  reload?: ReloadMenu,
  buildLabel?: BuildLabelMenu,
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
        commandItem(APP_COMMAND.CLOSE_OTHER_TABS),
        closeWindowItem(),
        SEPARATOR,
        commandItem(APP_COMMAND.COPY_LINK),
        commandItem(APP_COMMAND.COPY_CONTENT),
        commandItem(APP_COMMAND.COPY_FULL_TRANSCRIPT),
        SEPARATOR,
        commandItem(APP_COMMAND.VERSION_HISTORY),
        SEPARATOR,
        menuItem(APP_COMMAND.MARK_TASK_DONE),
        opening(commandItem(APP_COMMAND.DELETE)),
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
      ],
    },
    {
      label: "View",
      submenu: [
        reloadItem(reload),
        SEPARATOR,
        commandItem(APP_COMMAND.TOGGLE_SIDEBAR),
        commandItem(APP_COMMAND.TOGGLE_SIDE_PANEL),
        commandItem(APP_COMMAND.SHOW_TERMINAL),
        commandItem(APP_COMMAND.TOGGLE_FULL_SCREEN),
        SEPARATOR,
        roleItem("togglefullscreen", APP_COMMAND.FULL_SCREEN),
        SEPARATOR,
        actualSizeItem(panel),
        { ...commandItem(APP_COMMAND.ZOOM_IN), label: "Zoom In" },
        commandItem(APP_COMMAND.ZOOM_OUT),
        ...(developerTools ? [SEPARATOR, developerItem(buildLabel)] : []),
      ],
    },
    {
      label: "Go",
      submenu: [
        commandItem(APP_COMMAND.COMMAND_PALETTE),
        SEPARATOR,
        commandItem(APP_COMMAND.HOME),
        commandItem(APP_COMMAND.INBOX),
        commandItem(APP_COMMAND.TASKS),
        commandItem(APP_COMMAND.AUTOMATIONS),
        SEPARATOR,
        commandItem(APP_COMMAND.BACK),
        commandItem(APP_COMMAND.FORWARD),
        SEPARATOR,
        commandItem(APP_COMMAND.PREVIOUS_TASK),
        commandItem(APP_COMMAND.NEXT_TASK),
      ],
    },
    {
      role: "windowMenu",
      submenu: [
        roleItem("minimize", APP_COMMAND.MINIMIZE),
        { role: "zoom" },
        SEPARATOR,
        ...(panel ? [mainWindowItem(appName, panel), SEPARATOR] : []),
        { role: "front" },
      ],
    },
    {
      role: "help",
      submenu: [
        commandItem(APP_COMMAND.KEYBOARD_SHORTCUTS),
        SEPARATOR,
        opening(menuItem(APP_COMMAND.SEND_FEEDBACK)),
      ],
    },
  ];
}
