/**
 * shortcuts.ts -- the window's keyboard shortcuts: one table the menu bar, the renderer's keymap, the hovers, and the Keyboard shortcuts page all read.
 *
 * Every shortcut but Escape and the Inbox's J and K holds Command, the way a
 * Mac app's own chords do, so none can be the talk or stop key: those take
 * the machine, and Command chords belong to whichever app is frontmost. J
 * and K are a letter alone, as Linear's and Superhuman's are, answered only
 * where the press is not typing, and the menu bar never offers them. Each is a command the window runs and
 * a chord that reaches it; the menu bar shows the chord beside the command's
 * name, and a click there sends the command to the window, which runs it
 * exactly as the key does. The key itself is the renderer's to read: Chromium
 * offers a Command chord to the page before the menu, and the keymap claims
 * it only while the command can run, so a chord nothing answers falls through
 * to the menu and from there to the same nothing.
 */

import { isWireString, type UnparsedWireValue } from "@luke/wire";
import {
  EXPERIMENT,
  type Experiment,
  type ExperimentChoices,
  experimentOn,
} from "./experiments.js";

/** What a shortcut does. A command is one entry here and one row in {@link APP_SHORTCUTS}, {@link MENU_COMMAND_LABELS}, or {@link PALETTE_COMMAND_LABELS}. */
export const APP_COMMAND = {
  NEW_TASK: "new-task",
  COPY_PLAN: "copy-plan",
  COPY_LINK: "copy-link",
  ARCHIVE_TASK: "archive-plan",
  DELETE_TASK: "delete-plan",
  PREVIOUS_TASK: "previous-plan",
  NEXT_TASK: "next-plan",
  TOGGLE_SIDEBAR: "toggle-sidebar",
  TOGGLE_SIDE_PANEL: "toggle-side-panel",
  TOGGLE_FULL_SCREEN: "toggle-full-screen",
  EXIT_FULL_SCREEN: "exit-full-screen",
  FULL_SCREEN: "full-screen",
  MINIMIZE: "minimize",
  HIDE: "hide",
  HIDE_OTHERS: "hide-others",
  QUIT: "quit",
  ACTUAL_SIZE: "actual-size",
  ZOOM_IN: "zoom-in",
  ZOOM_OUT: "zoom-out",
  TOGGLE_MICROPHONE: "toggle-microphone",
  TOGGLE_SPEAKER: "toggle-speaker",
  MOVE_TAB_LEFT: "move-tab-left",
  MOVE_TAB_RIGHT: "move-tab-right",
  NEW_TAB: "new-tab",
  CLOSE_TAB: "close-tab",
  REOPEN_CLOSED_TAB: "reopen-closed-tab",
  CLOSE_WINDOW: "close-window",
  SETTINGS: "settings",
  KEYBOARD_SHORTCUTS: "keyboard-shortcuts",
  FIND: "find",
  FIND_NEXT: "find-next",
  FIND_PREVIOUS: "find-previous",
  EXIT_SETTINGS: "exit-settings",
  EXIT_VERSION_HISTORY: "exit-version-history",
  HOME: "home",
  INBOX: "inbox",
  INBOX_LIST: "inbox-list",
  PREVIOUS_INBOX_ITEM: "previous-inbox-item",
  NEXT_INBOX_ITEM: "next-inbox-item",
  EXIT_AGENT_PAGE: "exit-agent-page",
  EXIT_PERSON_PAGE: "exit-person-page",
  FACTORY: "factory",
  EXIT_FACTORY: "exit-factory",
  AUTOMATIONS: "automations",
  EXIT_AUTOMATIONS: "exit-automations",
  ISSUES: "issues",
  EXIT_ISSUES: "exit-issues",
  NEW_ISSUE: "new-issue",
  BACK: "back",
  FORWARD: "forward",
  SEND_FEEDBACK: "send-feedback",
  SUGGEST_FEATURE: "suggest-feature",
  COMMAND_PALETTE: "command-palette",
  SHOW_TERMINAL: "show-terminal",
  NEW_TERMINAL: "new-terminal",
  MENTION_LINES: "mention-lines",
  GROUP_TASKS_BY_REPOSITORY: "group-tasks-by-repository",
  GROUP_TASKS_BY_CREATOR: "group-tasks-by-creator",
  LIST_TASKS_UNGROUPED: "list-tasks-ungrouped",
  ORDER_TASKS_BY_UPDATED: "order-tasks-by-updated",
  ORDER_TASKS_BY_CREATED: "order-tasks-by-created",
  ORDER_TASKS_BY_NAME: "order-tasks-by-name",
  SHOW_MY_TASKS: "show-my-tasks",
  SHOW_EVERYONES_TASKS: "show-everyones-tasks",
  SHOW_ARCHIVED_TASKS: "show-archived-tasks",
  HIDE_ARCHIVED_TASKS: "hide-archived-tasks",
  INSERT_PICTURE: "insert-picture",
} as const;

export type AppCommand = (typeof APP_COMMAND)[keyof typeof APP_COMMAND];

/**
 * The commands the menu bar alone offers, by the name it gives them: a
 * dialog reached now and then, or a new shell in an agent's sandbox, which
 * ⌘K and the panel's "+" reach too; none takes the window's keys.
 */
export const MENU_COMMAND_LABELS = {
  [APP_COMMAND.SEND_FEEDBACK]: "Send feedback",
  [APP_COMMAND.SUGGEST_FEATURE]: "Suggest a feature",
  [APP_COMMAND.NEW_TERMINAL]: "New terminal",
} as const;

export type MenuCommand = keyof typeof MENU_COMMAND_LABELS;

/**
 * The commands ⌘K alone offers, by the name it gives them: the sidebar's
 * view of its tasks, which its View options menu sets too, and Factory,
 * which the sidebar's row opens, so no chord or menu bar item spends a key
 * on them. Factory keeps no chord while it is an experiment, so ⇧⌘F stays
 * free for a find across everything; ⌘K offers it only while the account
 * has it on, since its command is offered nothing otherwise.
 */
const PALETTE_COMMAND_LABELS = {
  [APP_COMMAND.FACTORY]: "Factory",
  [APP_COMMAND.GROUP_TASKS_BY_REPOSITORY]: "Group tasks by repository",
  [APP_COMMAND.GROUP_TASKS_BY_CREATOR]: "Group tasks by creator",
  [APP_COMMAND.LIST_TASKS_UNGROUPED]: "Show tasks in one list",
  [APP_COMMAND.ORDER_TASKS_BY_UPDATED]: "Order tasks by last updated",
  [APP_COMMAND.ORDER_TASKS_BY_CREATED]: "Order tasks by created",
  [APP_COMMAND.ORDER_TASKS_BY_NAME]: "Order tasks by name",
  [APP_COMMAND.SHOW_MY_TASKS]: "Show my tasks",
  [APP_COMMAND.SHOW_EVERYONES_TASKS]: "Show everyone's tasks",
  [APP_COMMAND.SHOW_ARCHIVED_TASKS]: "Show archived tasks",
  [APP_COMMAND.HIDE_ARCHIVED_TASKS]: "Hide archived tasks",
} as const;

export type PaletteCommand = keyof typeof PALETTE_COMMAND_LABELS;

/** Every command ⌘K alone offers, in the order the table declares them. */
export const PALETTE_COMMANDS = Object.keys(PALETTE_COMMAND_LABELS).filter(
  (command): command is PaletteCommand => Object.hasOwn(PALETTE_COMMAND_LABELS, command),
);

/** A command a chord reaches: every command neither the menu bar nor ⌘K keeps to itself. */
export type KeyedCommand = Exclude<AppCommand, MenuCommand | PaletteCommand>;

/**
 * A key a chord ends in, spelt each way it is needed: Electron's accelerator,
 * the glyph drawn for it, `KeyboardEvent.key` without Option, and the
 * physical `code` with Option, which turns a letter into some other character
 * on a Mac keyboard. `editsText` marks a key a text field already answers
 * with Command held, which the keymap leaves to the field. `unshifted` is the
 * character the same key types without Shift where `key` needs it on a US
 * keyboard, and `aria` the key's name where `aria-keyshortcuts` cannot spell
 * it as its character.
 */
interface ShortcutKey {
  accelerator: string;
  glyph: string;
  key: string;
  code: string;
  editsText?: true;
  unshifted?: string;
  aria?: string;
}

export const SHORTCUT_KEY = {
  N: { accelerator: "N", glyph: "N", key: "n", code: "KeyN" },
  A: { accelerator: "A", glyph: "A", key: "a", code: "KeyA" },
  C: { accelerator: "C", glyph: "C", key: "c", code: "KeyC" },
  M: { accelerator: "M", glyph: "M", key: "m", code: "KeyM" },
  H: { accelerator: "H", glyph: "H", key: "h", code: "KeyH" },
  Q: { accelerator: "Q", glyph: "Q", key: "q", code: "KeyQ" },
  S: { accelerator: "S", glyph: "S", key: "s", code: "KeyS" },
  B: { accelerator: "B", glyph: "B", key: "b", code: "KeyB" },
  F: { accelerator: "F", glyph: "F", key: "f", code: "KeyF" },
  G: { accelerator: "G", glyph: "G", key: "g", code: "KeyG" },
  T: { accelerator: "T", glyph: "T", key: "t", code: "KeyT" },
  W: { accelerator: "W", glyph: "W", key: "w", code: "KeyW" },
  K: { accelerator: "K", glyph: "K", key: "k", code: "KeyK" },
  J: { accelerator: "J", glyph: "J", key: "j", code: "KeyJ" },
  I: { accelerator: "I", glyph: "I", key: "i", code: "KeyI" },
  U: { accelerator: "U", glyph: "U", key: "u", code: "KeyU" },
  ZERO: { accelerator: "0", glyph: "0", key: "0", code: "Digit0" },
  // ⌘+ answers ⌘= as well, so zooming in never needs Shift, as in Chrome and
  // VS Code.
  PLUS: { accelerator: "Plus", glyph: "+", key: "+", code: "Equal", unshifted: "=", aria: "Plus" },
  MINUS: { accelerator: "-", glyph: "−", key: "-", code: "Minus" },
  // A bare = is the picture viewer's own zoom in, the key + shares unshifted.
  EQUALS: { accelerator: "=", glyph: "=", key: "=", code: "Equal" },
  UP: { accelerator: "Up", glyph: "↑", key: "ArrowUp", code: "ArrowUp" },
  DOWN: { accelerator: "Down", glyph: "↓", key: "ArrowDown", code: "ArrowDown" },
  LEFT: { accelerator: "Left", glyph: "←", key: "ArrowLeft", code: "ArrowLeft", editsText: true },
  RIGHT: {
    accelerator: "Right",
    glyph: "→",
    key: "ArrowRight",
    code: "ArrowRight",
    editsText: true,
  },
  COMMA: { accelerator: ",", glyph: ",", key: ",", code: "Comma" },
  SLASH: { accelerator: "/", glyph: "/", key: "/", code: "Slash" },
  // Note that Return is ⏎ rather than ↩, because the system face draws ⏎ as
  // the Mac's own Return mark, centred on the capitals as ⌘ is, and has no ↩:
  // a ↩ is borrowed from another face and sits off the line beside it.
  ENTER: { accelerator: "Enter", glyph: "⏎", key: "Enter", code: "Enter" },
  ESCAPE: { accelerator: "Escape", glyph: "Esc", key: "Escape", code: "Escape" },
  OPEN_BRACKET: { accelerator: "[", glyph: "[", key: "[", code: "BracketLeft" },
  CLOSE_BRACKET: { accelerator: "]", glyph: "]", key: "]", code: "BracketRight" },
  BACKSPACE: {
    accelerator: "Backspace",
    glyph: "⌫",
    key: "Backspace",
    code: "Backspace",
    editsText: true,
  },
} as const satisfies Record<string, ShortcutKey>;

/** The glyph each key the table names is drawn in, by the name an accelerator gives it. */
const KEY_GLYPHS: ReadonlyMap<string, string> = new Map(
  Object.values(SHORTCUT_KEY).map((key) => [key.accelerator, key.glyph]),
);

/** The modifiers' glyphs in the order macOS writes a chord in. */
const MODIFIER_GLYPHS = ["⌃", "⌥", "⇧", "⌘"] as const;

/** Every name an accelerator gives a modifier, Electron's and its aliases, folded to the glyph macOS draws it in. */
const MODIFIER_GLYPH = {
  Control: "⌃",
  Ctrl: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
  Command: "⌘",
  Cmd: "⌘",
  CommandOrControl: "⌘",
  CmdOrCtrl: "⌘",
} as const satisfies Record<string, (typeof MODIFIER_GLYPHS)[number]>;

function modifierGlyph(name: string): string {
  if (!Object.hasOwn(MODIFIER_GLYPH, name)) return name;
  // SAFETY: Object.hasOwn narrows name to a key the glyph table documents.
  return MODIFIER_GLYPH[name as keyof typeof MODIFIER_GLYPH];
}

/**
 * A chord: Command, the modifiers named here, and the key. A `bare` chord is
 * the key alone, which only Escape is: the window's Escape steps back one
 * layer at a time in `app.tsx`, so the keymap leaves it there, and the table
 * names it so the menu bar and the shortcuts page can say what it does. A
 * `plain` chord is a letter alone too, which the keymap answers itself, but
 * only where the press is not typing into a field, and which no menu item
 * carries, since a menu's bare key would take the letter from every field.
 * Control joins only the system's own ⌃⌘F, since a Control chord is
 * otherwise a text field's caret move.
 */
export interface ShortcutChord {
  key: ShortcutKey;
  control?: true;
  option?: true;
  shift?: true;
  bare?: true;
  plain?: true;
}

/** Whether a chord is pressed without Command: the window's layered Escape, or a letter alone. */
function commandless(chord: ShortcutChord): boolean {
  return chord.bare === true || chord.plain === true;
}

/** One command as the menu, the hover, and the shortcuts page name it, and the chord that runs it. */
export interface AppShortcut {
  label: string;
  chord: ShortcutChord;
  /**
   * The experiment a gated feature's command belongs to. While the account
   * has it off, the command is in no list: not the Keyboard shortcuts page,
   * not the settings search, and not the menu bar. Its chord stays reserved
   * here all the same, so turning the experiment on never collides with
   * another command.
   */
  experiment?: Experiment;
}

/**
 * Every shortcut. The chords are the ones Mac devtools already taught: ⌘N and ⌘, everywhere,
 * ⌥⌘B for the secondary sidebar as VS Code and Cursor have it, ⌘/ for the
 * shortcuts as ChatGPT has it, ⌘[ and ⌘] for back and forward as Finder and
 * Safari have them, ⇧⌘H for home as Finder has it, ⇧⌘⏎ to fill the window
 * with a pane as iTerm and Warp have it, ⇧⌘← and ⇧⌘→ to move the focused tab along its strip, the
 * keys VS Code's Move Editor Left and Right end in, ⌘T to open a tab, ⌘W
 * to close the tab chosen, ⇧⌘T to reopen the tab closed last, and ⇧⌘W to
 * close the window as Chrome and VS Code have them,
 * ⇧⌘M to toggle the call's microphone as Teams has it, with ⇧⌘S for its
 * speaker beside it, ⌘K for the command palette as Linear, Slack, and
 * Raycast have it, ⌘J for the terminal as VS Code and Cursor have the
 * panel that holds it, ⌥⌘K to mention a File tab's selected lines in the
 * agent's message box, beside the palette's ⌘K, ⌘F to find, and ⌘G and ⇧⌘G to step through what it
 * found, as every Mac app has them, and ⌘+, ⌘−, and ⌘0 to zoom as every
 * browser has them.
 *
 * The system's own chords stand here too — ⌘H, ⌥⌘H, ⌘Q, ⌘M, and ⌃⌘F, which
 * every Mac app answers through the menu bar's standard items — so the menu
 * reads them from here and the shortcuts page lists them. No control ever
 * offers their commands, so the keymap never claims their keys, and the
 * menu's own items answer them.
 */
export const APP_SHORTCUTS = {
  [APP_COMMAND.NEW_TASK]: { label: "New task", chord: { key: SHORTCUT_KEY.N } },
  [APP_COMMAND.COPY_PLAN]: { label: "Copy plan", chord: { key: SHORTCUT_KEY.C, shift: true } },
  // Note that ⇧⌘C, Linear's chord for a link, was Copy plan's first, so a link takes ⌥⌘C, where macOS copies a thing's address (Finder's Copy as Pathname).
  [APP_COMMAND.COPY_LINK]: { label: "Copy link", chord: { key: SHORTCUT_KEY.C, option: true } },
  [APP_COMMAND.ARCHIVE_TASK]: {
    label: "Archive task",
    chord: { key: SHORTCUT_KEY.A, shift: true },
  },
  [APP_COMMAND.DELETE_TASK]: {
    label: "Permanently delete task",
    chord: { key: SHORTCUT_KEY.BACKSPACE },
  },
  [APP_COMMAND.PREVIOUS_TASK]: {
    label: "Previous task",
    chord: { key: SHORTCUT_KEY.UP, option: true },
  },
  [APP_COMMAND.NEXT_TASK]: { label: "Next task", chord: { key: SHORTCUT_KEY.DOWN, option: true } },
  [APP_COMMAND.TOGGLE_SIDEBAR]: { label: "Toggle sidebar", chord: { key: SHORTCUT_KEY.B } },
  [APP_COMMAND.TOGGLE_SIDE_PANEL]: {
    label: "Toggle panel",
    chord: { key: SHORTCUT_KEY.B, option: true },
  },
  [APP_COMMAND.TOGGLE_FULL_SCREEN]: {
    label: "Toggle panel full screen",
    chord: { key: SHORTCUT_KEY.ENTER, shift: true },
  },
  [APP_COMMAND.EXIT_FULL_SCREEN]: {
    label: "Exit panel full screen",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.FULL_SCREEN]: {
    label: "Toggle full screen",
    chord: { key: SHORTCUT_KEY.F, control: true },
  },
  [APP_COMMAND.MINIMIZE]: { label: "Minimize", chord: { key: SHORTCUT_KEY.M } },
  [APP_COMMAND.HIDE]: { label: "Hide Luke", chord: { key: SHORTCUT_KEY.H } },
  [APP_COMMAND.HIDE_OTHERS]: {
    label: "Hide others",
    chord: { key: SHORTCUT_KEY.H, option: true },
  },
  [APP_COMMAND.QUIT]: { label: "Quit Luke", chord: { key: SHORTCUT_KEY.Q } },
  [APP_COMMAND.ACTUAL_SIZE]: { label: "Actual size", chord: { key: SHORTCUT_KEY.ZERO } },
  [APP_COMMAND.ZOOM_IN]: { label: "Zoom in", chord: { key: SHORTCUT_KEY.PLUS } },
  [APP_COMMAND.ZOOM_OUT]: { label: "Zoom out", chord: { key: SHORTCUT_KEY.MINUS } },
  [APP_COMMAND.TOGGLE_MICROPHONE]: {
    label: "Toggle microphone",
    chord: { key: SHORTCUT_KEY.M, shift: true },
  },
  [APP_COMMAND.TOGGLE_SPEAKER]: {
    label: "Toggle speaker",
    chord: { key: SHORTCUT_KEY.S, shift: true },
  },
  [APP_COMMAND.MOVE_TAB_LEFT]: {
    label: "Move tab left",
    chord: { key: SHORTCUT_KEY.LEFT, shift: true },
  },
  [APP_COMMAND.MOVE_TAB_RIGHT]: {
    label: "Move tab right",
    chord: { key: SHORTCUT_KEY.RIGHT, shift: true },
  },
  [APP_COMMAND.NEW_TAB]: { label: "New tab", chord: { key: SHORTCUT_KEY.T } },
  [APP_COMMAND.CLOSE_TAB]: { label: "Close tab", chord: { key: SHORTCUT_KEY.W } },
  [APP_COMMAND.REOPEN_CLOSED_TAB]: {
    label: "Reopen closed tab",
    chord: { key: SHORTCUT_KEY.T, shift: true },
  },
  [APP_COMMAND.CLOSE_WINDOW]: {
    label: "Close window",
    chord: { key: SHORTCUT_KEY.W, shift: true },
  },
  [APP_COMMAND.SETTINGS]: { label: "Settings", chord: { key: SHORTCUT_KEY.COMMA } },
  [APP_COMMAND.KEYBOARD_SHORTCUTS]: {
    label: "Keyboard shortcuts",
    chord: { key: SHORTCUT_KEY.SLASH },
  },
  [APP_COMMAND.FIND]: { label: "Find", chord: { key: SHORTCUT_KEY.F } },
  [APP_COMMAND.FIND_NEXT]: { label: "Find next", chord: { key: SHORTCUT_KEY.G } },
  [APP_COMMAND.FIND_PREVIOUS]: {
    label: "Find previous",
    chord: { key: SHORTCUT_KEY.G, shift: true },
  },
  [APP_COMMAND.EXIT_SETTINGS]: {
    label: "Exit settings",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.EXIT_VERSION_HISTORY]: {
    label: "Exit version history",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.HOME]: { label: "Home", chord: { key: SHORTCUT_KEY.H, shift: true } },
  [APP_COMMAND.INBOX]: { label: "Inbox", chord: { key: SHORTCUT_KEY.I, shift: true } },
  [APP_COMMAND.INBOX_LIST]: {
    label: "Back to inbox list",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.PREVIOUS_INBOX_ITEM]: {
    label: "Previous inbox item",
    chord: { key: SHORTCUT_KEY.K, plain: true },
  },
  [APP_COMMAND.NEXT_INBOX_ITEM]: {
    label: "Next inbox item",
    chord: { key: SHORTCUT_KEY.J, plain: true },
  },
  [APP_COMMAND.EXIT_AGENT_PAGE]: {
    label: "Exit agent page",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.EXIT_PERSON_PAGE]: {
    label: "Exit profile",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.EXIT_FACTORY]: {
    label: "Exit factory",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
    experiment: EXPERIMENT.FACTORY,
  },
  [APP_COMMAND.AUTOMATIONS]: {
    label: "Automations",
    chord: { key: SHORTCUT_KEY.U, shift: true },
    experiment: EXPERIMENT.AUTOMATIONS,
  },
  [APP_COMMAND.EXIT_AUTOMATIONS]: {
    label: "Exit automations",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
    experiment: EXPERIMENT.AUTOMATIONS,
  },
  [APP_COMMAND.ISSUES]: {
    label: "Issues",
    chord: { key: SHORTCUT_KEY.K, shift: true },
    experiment: EXPERIMENT.ISSUES,
  },
  [APP_COMMAND.EXIT_ISSUES]: {
    label: "Exit issues",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
    experiment: EXPERIMENT.ISSUES,
  },
  [APP_COMMAND.NEW_ISSUE]: {
    label: "New issue",
    chord: { key: SHORTCUT_KEY.C, plain: true },
    experiment: EXPERIMENT.ISSUES,
  },
  [APP_COMMAND.BACK]: { label: "Back", chord: { key: SHORTCUT_KEY.OPEN_BRACKET } },
  [APP_COMMAND.FORWARD]: { label: "Forward", chord: { key: SHORTCUT_KEY.CLOSE_BRACKET } },
  [APP_COMMAND.COMMAND_PALETTE]: { label: "Command palette", chord: { key: SHORTCUT_KEY.K } },
  [APP_COMMAND.SHOW_TERMINAL]: { label: "Show terminal", chord: { key: SHORTCUT_KEY.J } },
  [APP_COMMAND.MENTION_LINES]: {
    label: "Mention lines in agent",
    chord: { key: SHORTCUT_KEY.K, option: true },
  },
  [APP_COMMAND.INSERT_PICTURE]: {
    label: "Insert image",
    chord: { key: SHORTCUT_KEY.I, option: true },
  },
} as const satisfies Record<KeyedCommand, AppShortcut>;

/**
 * The shortcuts as the Keyboard shortcuts page and the command palette list
 * them: in groups that follow the menu bar, under the group's name in
 * sentence case, every keyed command in exactly one.
 */
export const APP_SHORTCUT_GROUPS = [
  {
    title: "General",
    commands: [
      APP_COMMAND.COMMAND_PALETTE,
      APP_COMMAND.SETTINGS,
      APP_COMMAND.KEYBOARD_SHORTCUTS,
      APP_COMMAND.FIND,
      APP_COMMAND.FIND_NEXT,
      APP_COMMAND.FIND_PREVIOUS,
      APP_COMMAND.EXIT_SETTINGS,
      APP_COMMAND.HIDE,
      APP_COMMAND.HIDE_OTHERS,
      APP_COMMAND.QUIT,
    ],
  },
  {
    title: "Tasks",
    commands: [
      APP_COMMAND.NEW_TASK,
      APP_COMMAND.COPY_PLAN,
      APP_COMMAND.COPY_LINK,
      APP_COMMAND.ARCHIVE_TASK,
      APP_COMMAND.DELETE_TASK,
      APP_COMMAND.EXIT_VERSION_HISTORY,
      APP_COMMAND.HOME,
      APP_COMMAND.INBOX,
      APP_COMMAND.INBOX_LIST,
      APP_COMMAND.PREVIOUS_INBOX_ITEM,
      APP_COMMAND.NEXT_INBOX_ITEM,
      APP_COMMAND.ISSUES,
      APP_COMMAND.EXIT_ISSUES,
      APP_COMMAND.NEW_ISSUE,
      APP_COMMAND.EXIT_AGENT_PAGE,
      APP_COMMAND.EXIT_PERSON_PAGE,
      APP_COMMAND.EXIT_FACTORY,
      APP_COMMAND.AUTOMATIONS,
      APP_COMMAND.EXIT_AUTOMATIONS,
    ],
  },
  {
    title: "Tabs & panels",
    commands: [
      APP_COMMAND.TOGGLE_SIDEBAR,
      APP_COMMAND.TOGGLE_SIDE_PANEL,
      APP_COMMAND.TOGGLE_FULL_SCREEN,
      APP_COMMAND.EXIT_FULL_SCREEN,
      APP_COMMAND.NEW_TAB,
      APP_COMMAND.CLOSE_TAB,
      APP_COMMAND.REOPEN_CLOSED_TAB,
      APP_COMMAND.MOVE_TAB_LEFT,
      APP_COMMAND.MOVE_TAB_RIGHT,
      APP_COMMAND.SHOW_TERMINAL,
      APP_COMMAND.MENTION_LINES,
      APP_COMMAND.INSERT_PICTURE,
    ],
  },
  {
    title: "Call",
    commands: [APP_COMMAND.TOGGLE_MICROPHONE, APP_COMMAND.TOGGLE_SPEAKER],
  },
  {
    title: "Navigation",
    commands: [
      APP_COMMAND.BACK,
      APP_COMMAND.FORWARD,
      APP_COMMAND.PREVIOUS_TASK,
      APP_COMMAND.NEXT_TASK,
    ],
  },
  {
    title: "Window",
    commands: [
      APP_COMMAND.FULL_SCREEN,
      APP_COMMAND.MINIMIZE,
      APP_COMMAND.ZOOM_IN,
      APP_COMMAND.ZOOM_OUT,
      APP_COMMAND.ACTUAL_SIZE,
      APP_COMMAND.CLOSE_WINDOW,
    ],
  },
] as const satisfies readonly { title: string; commands: readonly KeyedCommand[] }[];

/** Every command, in the order the table declares them. */
const APP_COMMANDS: readonly AppCommand[] = Object.values(APP_COMMAND);

/** Whether the menu bar alone offers the command. */
function isMenuCommand(command: AppCommand): command is MenuCommand {
  return Object.hasOwn(MENU_COMMAND_LABELS, command);
}

/** Whether a chord reaches the command, rather than the menu bar or ⌘K alone. */
export function isKeyedCommand(command: AppCommand): command is KeyedCommand {
  return !isMenuCommand(command) && !Object.hasOwn(PALETTE_COMMAND_LABELS, command);
}

/** Every command a chord reaches, in the order the table declares them. */
export const KEYED_COMMANDS: readonly KeyedCommand[] = APP_COMMANDS.filter(isKeyedCommand);

/**
 * Whether a keyed command stands in the window's lists for the account's
 * experiments: every command does but a gated feature's while its
 * experiment is off.
 */
export function shortcutShown(command: KeyedCommand, experiments: ExperimentChoices): boolean {
  const shortcut: AppShortcut = APP_SHORTCUTS[command];
  return shortcut.experiment === undefined || experimentOn(experiments, shortcut.experiment);
}

/** The shortcut groups with only the commands that stand for the account's experiments, as every list of them reads them. */
export function shownShortcutGroups(
  experiments: ExperimentChoices,
): readonly { readonly title: string; readonly commands: readonly KeyedCommand[] }[] {
  return APP_SHORTCUT_GROUPS.map((group) => ({
    ...group,
    commands: group.commands.filter((command) => shortcutShown(command, experiments)),
  })).filter((group) => group.commands.length > 0);
}

/** A command's name as the window says it, keyed, the menu bar's own, or ⌘K's own. */
export function appCommandLabel(command: AppCommand): string {
  if (isKeyedCommand(command)) return APP_SHORTCUTS[command].label;
  return isMenuCommand(command) ? MENU_COMMAND_LABELS[command] : PALETTE_COMMAND_LABELS[command];
}

/** Whether a value that crossed a process boundary names a command this build knows. */
export function isAppCommand(value: UnparsedWireValue): value is AppCommand {
  return isWireString(value) && APP_COMMANDS.some((command) => command === value);
}

/** The chord as Electron's accelerator, for the menu bar. */
export function shortcutAccelerator(chord: ShortcutChord): string {
  return [
    chord.control ? "Control" : undefined,
    chord.option ? "Alt" : undefined,
    chord.shift ? "Shift" : undefined,
    commandless(chord) ? undefined : "Command",
    chord.key.accelerator,
  ]
    .filter((part) => part !== undefined)
    .join("+");
}

/**
 * Any chord's glyphs as the window draws them, one per key: the modifiers in
 * the order macOS writes them, ⌃⌥⇧⌘, then the key. It reads Electron's
 * accelerator, the one spelling the window's chords (`shortcutAccelerator`)
 * and the system-wide keys Settings stores share, so the two are drawn by one
 * rule: a key the window's table names takes its glyph, ⏎ for Return and ⌫
 * for Delete, and any other, Space or a letter, its name.
 */
export function shortcutGlyphs(accelerator: string): readonly string[] {
  const parts = accelerator.split("+");
  const key = parts.at(-1) ?? "";
  const held = new Set(parts.slice(0, -1).map(modifierGlyph));
  // A name no modifier answers to is kept, ahead of the ones that do, rather than dropped.
  const unknown = [...held].filter((glyph) => !MODIFIER_GLYPHS.some((each) => each === glyph));
  const ordered = MODIFIER_GLYPHS.filter((glyph) => held.has(glyph));
  return [...unknown, ...ordered, KEY_GLYPHS.get(key) ?? key];
}

/** Any chord as words, its glyphs set tight as a menu prints a key equivalent: ⇧⌘I, ⌥Space, Esc. */
export function shortcutLabel(accelerator: string): string {
  return shortcutGlyphs(accelerator).join("");
}

/** The chord as `aria-keyshortcuts` spells it. */
export function shortcutAria(chord: ShortcutChord): string {
  return [
    commandless(chord) ? undefined : "Meta",
    chord.control ? "Control" : undefined,
    chord.option ? "Alt" : undefined,
    chord.shift ? "Shift" : undefined,
    chord.key.aria ?? (chord.key.key.length === 1 ? chord.key.key.toUpperCase() : chord.key.key),
  ]
    .filter((part) => part !== undefined)
    .join("+");
}

/**
 * Whether a key press is the chord: Command, unless the chord goes without, and exactly the chord's other
 * modifiers, and the key. The character is read where it can be,
 * which is what the menu bar matches too, and the physical key where Option
 * has changed the character. A key with an unshifted character answers
 * either character, Shift held or not, because which of the two needs Shift
 * is the keyboard layout's to say.
 */
function shortcutMatches(chord: ShortcutChord, event: KeyboardEvent): boolean {
  if (event.metaKey === commandless(chord)) return false;
  if (event.ctrlKey !== (chord.control === true)) return false;
  const shiftFree = chord.key.unshifted !== undefined;
  if (event.altKey !== (chord.option === true)) return false;
  if (!shiftFree && event.shiftKey !== (chord.shift === true)) return false;
  if (event.altKey) return event.code === chord.key.code;
  const pressed = event.key.toLowerCase();
  return pressed === chord.key.key.toLowerCase() || pressed === chord.key.unshifted;
}

/** The command whose chord a key press is, among those given, or nothing. */
export function commandForKey(
  commands: readonly KeyedCommand[],
  event: KeyboardEvent,
): KeyedCommand | undefined {
  return commands.find((command) => shortcutMatches(APP_SHORTCUTS[command].chord, event));
}

/** Whether the keymap leaves the chord to the window's own Escape, which steps back a layer at a time. */
export function shortcutLayered(chord: ShortcutChord): boolean {
  return chord.bare === true;
}

/** Whether a field taking typing already answers the chord, so it is left to the field: a key it edits with, or a letter alone. */
export function shortcutEditsText(chord: ShortcutChord): boolean {
  return chord.key.editsText === true || chord.plain === true;
}
