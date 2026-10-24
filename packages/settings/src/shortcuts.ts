/**
 * shortcuts.ts -- the window's keyboard shortcuts: one table the menu bar, the renderer's keymap, the hovers, and the Keyboard shortcuts page all read.
 *
 * Every shortcut but Escape, the Inbox's and Chat's J and K, the tab switcher's
 * ⌃Tab, and the ⌥↓ that opens a focused control's card holds Command, the way a
 * Mac app's own chords do, since Command chords belong to whichever app is
 * frontmost; in a browser on Windows or Linux, Command is pressed as Ctrl, as
 * every app there has it, and drawn so (`COMMAND_KEY`). J
 * and K are a letter alone, as Linear's and Superhuman's are, and R, which
 * replies to an agent's words selected as GitHub's R quotes them, answered
 * only where the press is not typing, and the menu bar never offers them. Each is a command the window runs and
 * a chord that reaches it; the menu bar shows the chord beside the command's
 * name, and a click there sends the command to the window, which runs it
 * exactly as the key does. The key itself is the renderer's to read: Chromium
 * offers a Command chord to the page before the menu, and the keymap claims
 * it only while the command can run, so a chord nothing answers falls through
 * to the menu and from there to the same nothing.
 */

import { isWireString, type UnparsedWireValue } from "@luke/wire";
import { HOST_CAPABILITY, type HostCapability } from "./capabilities.js";
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
  COMMENT_ON_SELECTION: "comment-on-selection",
  // Note that Mark done keeps Archive's id, because it took Archive's place and its chord, so the menu bar's item and any saved use of the id still reach it.
  MARK_TASK_DONE: "archive-plan",
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
  RELOAD: "reload",
  ACTUAL_SIZE: "actual-size",
  ZOOM_IN: "zoom-in",
  ZOOM_OUT: "zoom-out",
  TOGGLE_MICROPHONE: "toggle-microphone",
  TOGGLE_SPEAKER: "toggle-speaker",
  MOVE_TAB_LEFT: "move-tab-left",
  MOVE_TAB_RIGHT: "move-tab-right",
  MOVE_ROW_UP: "move-row-up",
  MOVE_ROW_DOWN: "move-row-down",
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
  INBOX: "inbox",
  TASKS: "tasks",
  INBOX_LIST: "inbox-list",
  PREVIOUS_INBOX_ITEM: "previous-inbox-item",
  NEXT_INBOX_ITEM: "next-inbox-item",
  CHAT: "chat",
  CHAT_LIST: "chat-list",
  PREVIOUS_CHAT_CHANNEL: "previous-chat-channel",
  NEXT_CHAT_CHANNEL: "next-chat-channel",
  NEXT_UNREAD_CHAT_CHANNEL: "next-unread-chat-channel",
  TOGGLE_INBOX_ITEM_READ: "toggle-inbox-item-read",
  REPLY_TO_SELECTION: "reply-to-selection",
  EXIT_AGENT_PAGE: "exit-agent-page",
  EXIT_PERSON_PAGE: "exit-person-page",
  ASK_LUKE: "ask-luke",
  AUTOMATIONS: "automations",
  EXIT_AUTOMATIONS: "exit-automations",
  EXIT_BOARD: "exit-board",
  ADMIN: "admin",
  EXIT_ADMIN: "exit-admin",
  BACK: "back",
  FORWARD: "forward",
  SEND_FEEDBACK: "send-feedback",
  SUGGEST_FEATURE: "suggest-feature",
  COMMAND_PALETTE: "command-palette",
  SHOW_TERMINAL: "show-terminal",
  NEW_TERMINAL: "new-terminal",
  MENTION_LINES: "mention-lines",
  GROUP_TASKS_BY_REPOSITORY: "group-tasks-by-repository",
  GROUP_TASKS_BY_ASSIGNEE: "group-tasks-by-assignee",
  GROUP_TASKS_BY_CREATOR: "group-tasks-by-creator",
  LIST_TASKS_UNGROUPED: "list-tasks-ungrouped",
  ORDER_TASKS_BY_UPDATED: "order-tasks-by-updated",
  ORDER_TASKS_BY_CREATED: "order-tasks-by-created",
  ORDER_TASKS_BY_NAME: "order-tasks-by-name",
  SHOW_MY_TASKS: "show-my-tasks",
  SHOW_EVERYONES_TASKS: "show-everyones-tasks",
  INSERT_PICTURE: "insert-picture",
  NEXT_RECENT_TAB: "next-recent-tab",
  PREVIOUS_RECENT_TAB: "previous-recent-tab",
  SHOW_DETAILS: "show-details",
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
 * view of its tasks, which its View options menu sets too, and Chat, which
 * the sidebar's row opens, so no chord or menu bar item spends a key on
 * them. Chat keeps no chord while it is an experiment, so ⇧⌘F stays free
 * for a find across everything; ⌘K offers it only while the account has it
 * on, since its command is offered nothing otherwise. Admin is an admin's
 * alone, so it spends no chord, and ⌘K offers it only to an admin, as its
 * sidebar row stands only for one.
 */
const PALETTE_COMMAND_LABELS = {
  [APP_COMMAND.CHAT]: "Chat",
  [APP_COMMAND.ADMIN]: "Admin",
  [APP_COMMAND.GROUP_TASKS_BY_REPOSITORY]: "Group tasks by repository",
  [APP_COMMAND.GROUP_TASKS_BY_ASSIGNEE]: "Group tasks by assignee",
  [APP_COMMAND.GROUP_TASKS_BY_CREATOR]: "Group tasks by creator",
  [APP_COMMAND.LIST_TASKS_UNGROUPED]: "Show tasks in one list",
  [APP_COMMAND.ORDER_TASKS_BY_UPDATED]: "Order tasks by last updated",
  [APP_COMMAND.ORDER_TASKS_BY_CREATED]: "Order tasks by created",
  [APP_COMMAND.ORDER_TASKS_BY_NAME]: "Order tasks by name",
  [APP_COMMAND.SHOW_MY_TASKS]: "Show my tasks",
  [APP_COMMAND.SHOW_EVERYONES_TASKS]: "Show everyone's tasks",
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
 * it as its character. `placed` marks a punctuation key a plain chord reads
 * by its place, because Shift, which a plain chord may hold, turns it into
 * another character (`;` into `:`, `/` into `?`); a Command chord still reads
 * its character, as the menu bar does.
 */
interface ShortcutKey {
  accelerator: string;
  glyph: string;
  key: string;
  code: string;
  editsText?: true;
  unshifted?: string;
  aria?: string;
  placed?: true;
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
  R: { accelerator: "R", glyph: "R", key: "r", code: "KeyR" },
  // A bare V is Files changed's own, marking the file stood on viewed; no app command holds it.
  V: { accelerator: "V", glyph: "V", key: "v", code: "KeyV" },
  // ⌘L is New task's own, opening its Linear chip from the name field; no app command holds it.
  L: { accelerator: "L", glyph: "L", key: "l", code: "KeyL" },
  // ⌘E, ⇧⌘X, and the digits but 0 are the writing chords' own (`WRITING_SHORTCUTS`); no app command holds them.
  E: { accelerator: "E", glyph: "E", key: "e", code: "KeyE" },
  X: { accelerator: "X", glyph: "X", key: "x", code: "KeyX" },
  ZERO: { accelerator: "0", glyph: "0", key: "0", code: "Digit0" },
  ONE: { accelerator: "1", glyph: "1", key: "1", code: "Digit1" },
  TWO: { accelerator: "2", glyph: "2", key: "2", code: "Digit2" },
  THREE: { accelerator: "3", glyph: "3", key: "3", code: "Digit3" },
  SEVEN: { accelerator: "7", glyph: "7", key: "7", code: "Digit7" },
  EIGHT: { accelerator: "8", glyph: "8", key: "8", code: "Digit8" },
  NINE: { accelerator: "9", glyph: "9", key: "9", code: "Digit9" },
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
  // ⇧/, the key `?` is typed on, is Files changed's own sheet of its keys, read by its place.
  SLASH: { accelerator: "/", glyph: "/", key: "/", code: "Slash", placed: true },
  // A bare ; and ⇧; are Files changed's own fold keys, stage-cli's, read by their place.
  SEMICOLON: { accelerator: ";", glyph: ";", key: ";", code: "Semicolon", placed: true },
  // Note that Return is ⏎ rather than ↩, because the system face draws ⏎ as
  // the Mac's own Return mark, centred on the capitals as ⌘ is, and has no ↩:
  // a ↩ is borrowed from another face and sits off the line beside it.
  ENTER: { accelerator: "Enter", glyph: "⏎", key: "Enter", code: "Enter" },
  // ⌃Tab and ⌃⇧Tab are the tab switcher's own; a bare Tab moves focus, as everywhere.
  TAB: { accelerator: "Tab", glyph: "⇥", key: "Tab", code: "Tab" },
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

/**
 * The key a chord's Command is pressed with: ⌘ on a Mac, as every Mac app has
 * it, and Ctrl on Windows and Linux, as every app there has it, where Meta is
 * the Windows key the system keeps for itself. The window's shell names it
 * once (`installCommandKey`); the desktop is a Mac's alone and names none.
 */
export const COMMAND_KEY = {
  META: "meta",
  CONTROL: "control",
} as const;

export type CommandKey = (typeof COMMAND_KEY)[keyof typeof COMMAND_KEY];

/**
 * The window's command key, ⌘ until its shell installs another. Note that this
 * is module state, as `@luke/panel`'s platform door is, because every reader
 * (a press matched, a chord drawn or spelled for a reader) reads it at the
 * moment it reads, never at load, and the shell knows it before anything is
 * drawn.
 */
let commandKey: CommandKey = COMMAND_KEY.META;

/** How `aria-keyshortcuts` names each command key. */
const COMMAND_ARIA = {
  [COMMAND_KEY.META]: "Meta",
  [COMMAND_KEY.CONTROL]: "Control",
} as const satisfies Record<CommandKey, string>;

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

/** The modifiers' words in the order Windows and Linux write a chord in, where Command is pressed as Ctrl. */
const MODIFIER_WORDS = ["Ctrl", "Alt", "Shift"] as const;

/** The same names folded to the word Windows and Linux spell each in: Command is Ctrl there, so it and Control are one key. */
const MODIFIER_WORD = {
  Control: "Ctrl",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
  Command: "Ctrl",
  Cmd: "Ctrl",
  CommandOrControl: "Ctrl",
  CmdOrCtrl: "Ctrl",
} as const satisfies Record<keyof typeof MODIFIER_GLYPH, (typeof MODIFIER_WORDS)[number]>;

/** How a chord's modifiers are drawn for each command key: their order, and the name each accelerator's modifier is drawn as. */
const MODIFIER_SPELLING = {
  [COMMAND_KEY.META]: { order: MODIFIER_GLYPHS, names: MODIFIER_GLYPH },
  [COMMAND_KEY.CONTROL]: { order: MODIFIER_WORDS, names: MODIFIER_WORD },
} as const;

function modifierGlyph(name: string): string {
  const { names } = MODIFIER_SPELLING[commandKey];
  if (!Object.hasOwn(names, name)) return name;
  // SAFETY: Object.hasOwn narrows name to a key the glyph table documents.
  return names[name as keyof typeof names];
}

/**
 * A chord: Command, the modifiers named here, and the key. A `bare` chord is
 * the key alone, which only Escape is: the window's Escape steps back one
 * layer at a time in `app.tsx`, so the keymap leaves it there, and the table
 * names it so the menu bar and the shortcuts page can say what it does. A
 * `plain` chord is a letter alone too, which the keymap answers itself, but
 * only where the press is not typing into a field, and which no menu item
 * carries, since a menu's bare key would take the letter from every field.
 * Control joins only the system's own ⌃⌘F, and the `switching` chords,
 * since a Control chord is otherwise a text field's caret move. A
 * `switching` chord is Control and its key without Command, ⌃Tab as every
 * browser's and editor's tab switcher has it: the switcher answers it
 * itself, from the press to the ⌃'s release (`tab-switcher.tsx` in
 * `@luke/panel`), so the keymap leaves it, as it leaves the layered Escape.
 */
export interface ShortcutChord {
  key: ShortcutKey;
  control?: true;
  option?: true;
  shift?: true;
  bare?: true;
  plain?: true;
  switching?: true;
}

/** Whether a chord is pressed without Command: the window's layered Escape, a letter alone, or the tab switcher's ⌃Tab. */
function commandless(chord: ShortcutChord): boolean {
  return chord.bare === true || chord.plain === true || chord.switching === true;
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
  /**
   * The platform capability the command's feature stands on. Where the
   * platform does not offer it, the command is in no list, as a gated
   * experiment's is not.
   */
  capability?: HostCapability;
}

/**
 * Every shortcut. The chords are the ones Mac devtools already taught: ⌘N and ⌘, everywhere,
 * ⌥⌘B for the secondary sidebar as VS Code and Cursor have it, ⌘/ for the
 * shortcuts as ChatGPT has it, ⌘[ and ⌘] for back and forward as Finder and
 * Safari have them, ⌃Tab and ⌃⇧Tab through the tabs used last as VS Code
 * and Chrome have them, ⇧⌘⏎ to fill the window
 * with a pane as iTerm and Warp have it, ⇧⌘← and ⇧⌘→ to move the focused tab along its strip, the
 * keys VS Code's Move Editor Left and Right end in, ⇧⌘↑ and ⇧⌘↓ to move the focused
 * row of a list that reorders up or down it, ⌘T to open a tab, ⌘W
 * to close the tab chosen, ⇧⌘T to reopen the tab closed last, and ⇧⌘W to
 * close the window as Chrome and VS Code have them,
 * ⇧⌘M to toggle the call's microphone as Teams has it, with ⇧⌘S for its
 * speaker beside it, ⌘K for the command palette as Linear, Slack, and
 * Raycast have it, ⌘J for the terminal as VS Code and Cursor have the
 * panel that holds it, ⌥⌘K to mention a File tab's selected lines in the
 * agent's message box, beside the palette's ⌘K, ⌥⌘M to comment on a plan's
 * words selected as Google Docs has it, ⌘F to find, and ⌘G and ⇧⌘G to step through what it
 * found, as every Mac app has them, and ⌘+, ⌘−, and ⌘0 to zoom as every
 * browser has them.
 *
 * The system's own chords stand here too — ⌘H, ⌥⌘H, ⌘Q, ⌘M, ⌃⌘F, and ⌘R,
 * which every Mac app answers through the menu bar's standard items, ⌘R
 * reloading the window as a browser and Slack do — so the menu
 * reads them from here and the shortcuts page lists them. No control ever
 * offers their commands, so the keymap never claims their keys, and the
 * menu's own items answer them.
 */
export const APP_SHORTCUTS = {
  [APP_COMMAND.NEW_TASK]: { label: "New task", chord: { key: SHORTCUT_KEY.N } },
  [APP_COMMAND.COPY_PLAN]: { label: "Copy plan", chord: { key: SHORTCUT_KEY.C, shift: true } },
  // Note that ⇧⌘C, Linear's chord for a link, was Copy plan's first, so a link takes ⌥⌘C, where macOS copies a thing's address (Finder's Copy as Pathname).
  [APP_COMMAND.COPY_LINK]: { label: "Copy link", chord: { key: SHORTCUT_KEY.C, option: true } },
  [APP_COMMAND.COMMENT_ON_SELECTION]: {
    label: "Comment on selection",
    chord: { key: SHORTCUT_KEY.M, option: true },
  },
  [APP_COMMAND.MARK_TASK_DONE]: {
    label: "Mark done",
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
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.MINIMIZE]: {
    label: "Minimize",
    chord: { key: SHORTCUT_KEY.M },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.HIDE]: {
    label: "Hide Luke",
    chord: { key: SHORTCUT_KEY.H },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.HIDE_OTHERS]: {
    label: "Hide others",
    chord: { key: SHORTCUT_KEY.H, option: true },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.QUIT]: {
    label: "Quit Luke",
    chord: { key: SHORTCUT_KEY.Q },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  // Note that Reload is the desktop's alone, because on the web the browser's own ⌘R reloads the tab.
  [APP_COMMAND.RELOAD]: {
    label: "Reload",
    chord: { key: SHORTCUT_KEY.R },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  // Note that the zoom chords are the desktop's alone, because only its window zooms: on the web the browser's own zoom keeps them.
  [APP_COMMAND.ACTUAL_SIZE]: {
    label: "Actual size",
    chord: { key: SHORTCUT_KEY.ZERO },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.ZOOM_IN]: {
    label: "Zoom in",
    chord: { key: SHORTCUT_KEY.PLUS },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.ZOOM_OUT]: {
    label: "Zoom out",
    chord: { key: SHORTCUT_KEY.MINUS },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.TOGGLE_MICROPHONE]: {
    label: "Mute or unmute microphone",
    chord: { key: SHORTCUT_KEY.M, shift: true },
    capability: HOST_CAPABILITY.VOICE,
  },
  [APP_COMMAND.TOGGLE_SPEAKER]: {
    label: "Mute or unmute speaker",
    chord: { key: SHORTCUT_KEY.S, shift: true },
    capability: HOST_CAPABILITY.VOICE,
  },
  [APP_COMMAND.MOVE_TAB_LEFT]: {
    label: "Move tab left",
    chord: { key: SHORTCUT_KEY.LEFT, shift: true },
  },
  [APP_COMMAND.MOVE_TAB_RIGHT]: {
    label: "Move tab right",
    chord: { key: SHORTCUT_KEY.RIGHT, shift: true },
  },
  // Note that a row takes the chords a tab's pair does, turned a quarter, because a list runs up and down where a strip runs along.
  [APP_COMMAND.MOVE_ROW_UP]: {
    label: "Move row up",
    chord: { key: SHORTCUT_KEY.UP, shift: true },
  },
  [APP_COMMAND.MOVE_ROW_DOWN]: {
    label: "Move row down",
    chord: { key: SHORTCUT_KEY.DOWN, shift: true },
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
    capability: HOST_CAPABILITY.DESKTOP_APP,
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
  [APP_COMMAND.INBOX]: { label: "Inbox", chord: { key: SHORTCUT_KEY.I, shift: true } },
  // Note that the Tasks page takes ⇧⌘B, for the Board it once was alone, because ⇧⌘T reopens a closed tab.
  [APP_COMMAND.TASKS]: { label: "Tasks", chord: { key: SHORTCUT_KEY.B, shift: true } },
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
  [APP_COMMAND.TOGGLE_INBOX_ITEM_READ]: {
    label: "Mark inbox item as read or unread",
    chord: { key: SHORTCUT_KEY.U, plain: true },
  },
  [APP_COMMAND.CHAT_LIST]: {
    label: "Back to chat list",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
    experiment: EXPERIMENT.CHAT,
  },
  // Note that Chat's K and J are the Inbox's own keys, because the two never stand at once and the keymap runs whichever is offered.
  [APP_COMMAND.PREVIOUS_CHAT_CHANNEL]: {
    label: "Previous chat channel",
    chord: { key: SHORTCUT_KEY.K, plain: true },
    experiment: EXPERIMENT.CHAT,
  },
  [APP_COMMAND.NEXT_CHAT_CHANNEL]: {
    label: "Next chat channel",
    chord: { key: SHORTCUT_KEY.J, plain: true },
    experiment: EXPERIMENT.CHAT,
  },
  [APP_COMMAND.NEXT_UNREAD_CHAT_CHANNEL]: {
    label: "Next unread chat channel",
    chord: { key: SHORTCUT_KEY.J, plain: true, shift: true },
    experiment: EXPERIMENT.CHAT,
  },
  [APP_COMMAND.REPLY_TO_SELECTION]: {
    label: "Reply to selection",
    chord: { key: SHORTCUT_KEY.R, plain: true },
  },
  [APP_COMMAND.EXIT_AGENT_PAGE]: {
    label: "Exit agent page",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.EXIT_PERSON_PAGE]: {
    label: "Exit profile",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  // Note that Luke takes ⇧⌘K beside the palette's ⌘K, whose first entry is Ask Luke, rather than ⇧⌘L, which macOS gives its Search With Google service.
  [APP_COMMAND.ASK_LUKE]: {
    label: "Ask Luke",
    chord: { key: SHORTCUT_KEY.K, shift: true },
    experiment: EXPERIMENT.OPERATOR,
  },
  [APP_COMMAND.AUTOMATIONS]: {
    label: "Automations",
    chord: { key: SHORTCUT_KEY.U, shift: true },
  },
  [APP_COMMAND.EXIT_AUTOMATIONS]: {
    label: "Exit automations",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.EXIT_BOARD]: {
    label: "Exit tasks",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.EXIT_ADMIN]: {
    label: "Exit admin",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },

  [APP_COMMAND.BACK]: { label: "Back", chord: { key: SHORTCUT_KEY.OPEN_BRACKET } },
  [APP_COMMAND.FORWARD]: { label: "Forward", chord: { key: SHORTCUT_KEY.CLOSE_BRACKET } },
  [APP_COMMAND.COMMAND_PALETTE]: { label: "Command palette", chord: { key: SHORTCUT_KEY.K } },
  [APP_COMMAND.SHOW_TERMINAL]: {
    label: "Show terminal",
    chord: { key: SHORTCUT_KEY.J },
    capability: HOST_CAPABILITY.TERMINALS,
  },
  [APP_COMMAND.MENTION_LINES]: {
    label: "Mention lines in agent",
    chord: { key: SHORTCUT_KEY.K, option: true },
  },
  [APP_COMMAND.INSERT_PICTURE]: {
    label: "Insert image",
    chord: { key: SHORTCUT_KEY.I, option: true },
  },
  // Note that ⌃Tab is a desktop app's alone, because a browser keeps it for its own tabs.
  [APP_COMMAND.NEXT_RECENT_TAB]: {
    label: "Next recent tab",
    chord: { key: SHORTCUT_KEY.TAB, control: true, switching: true },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.PREVIOUS_RECENT_TAB]: {
    label: "Previous recent tab",
    chord: { key: SHORTCUT_KEY.TAB, control: true, shift: true, switching: true },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  // Note that a card opens on ⌥↓ without Command, as a closed list box opens on it, because only the focused control that hangs the card answers it (`hint.tsx` in `@luke/ui`), so nothing offers it to the window's keymap and a field keeps it for its caret.
  [APP_COMMAND.SHOW_DETAILS]: {
    label: "Show details",
    chord: { key: SHORTCUT_KEY.DOWN, option: true, plain: true },
  },
} as const satisfies Record<KeyedCommand, AppShortcut>;

/**
 * A key the Keyboard shortcuts page lists that no app command holds: the
 * window's layered Escape, named once for every layer it steps back from,
 * or one that answers in one place alone, where focus or a selection
 * stands. The window's keymap never claims one and no menu item carries it;
 * each place answers it itself, and this table only names it for the page.
 */
export const IN_CONTEXT_KEY = {
  STEP_BACK: "in-context-step-back",
  INBOX_OPTION: "in-context-inbox-option",
  NEW_TASK_ISSUE: "in-context-new-task-issue",
  TAB_STRIP_PREVIOUS: "in-context-tab-strip-previous",
  TAB_STRIP_NEXT: "in-context-tab-strip-next",
  TAB_STRIP_CLOSE: "in-context-tab-strip-close",
  SWITCHER_NEXT: "in-context-switcher-next",
  SWITCHER_PREVIOUS: "in-context-switcher-previous",
  SWITCHER_GO: "in-context-switcher-go",
  VIEWER_PREVIOUS: "in-context-viewer-previous",
  VIEWER_NEXT: "in-context-viewer-next",
  VIEWER_ZOOM_IN: "in-context-viewer-zoom-in",
  VIEWER_ZOOM_OUT: "in-context-viewer-zoom-out",
  VIEWER_FIT: "in-context-viewer-fit",
  LINK: "in-context-link",
  MENTION_WRITE: "in-context-mention-write",
  MENTION_OPEN: "in-context-mention-open",
} as const;

export type InContextKey = (typeof IN_CONTEXT_KEY)[keyof typeof IN_CONTEXT_KEY];

/**
 * One key the page lists in its place: its name, its chord, and, for a run
 * of keys, the last of them (`through`), 1 through 9. A platform feature's
 * key is listed only where the platform offers it (`capability`).
 */
export interface InContextShortcut {
  label: string;
  chord: ShortcutChord;
  through?: ShortcutChord;
  capability?: HostCapability;
}

/**
 * The keys that answer in place, each read where its place answers it: the
 * window's layered Escape, once for every layer it steps back from
 * (`app.tsx` in `@luke/panel`); an Inbox ask's options by their number
 * (`inbox-ask-controls.tsx`); New task's ⌘L for its issue
 * (`issue-picker-chip.tsx`); a tab strip's arrows and Delete (`tabs.tsx` in
 * `@luke/ui`); the tab switcher's keys while ⌃ is held (`tab-switcher.tsx`);
 * the file viewer's arrows and its picture's zoom (`attachment-viewer.tsx`,
 * `zoom-image.tsx` in `@luke/ui`); ⌘K over selected words for a link
 * (`writing-format.ts`); and the `@` list's Tab and → (`mention-picker.tsx`).
 */
export const IN_CONTEXT_SHORTCUTS = {
  [IN_CONTEXT_KEY.STEP_BACK]: {
    label: "Close what's open, or step back",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [IN_CONTEXT_KEY.INBOX_OPTION]: {
    label: "Choose an inbox option by its number",
    chord: { key: SHORTCUT_KEY.ONE, plain: true },
    through: { key: SHORTCUT_KEY.NINE, plain: true },
  },
  [IN_CONTEXT_KEY.NEW_TASK_ISSUE]: {
    label: "Choose an issue for a new task",
    chord: { key: SHORTCUT_KEY.L },
  },
  [IN_CONTEXT_KEY.TAB_STRIP_PREVIOUS]: {
    label: "Focus previous tab in strip",
    chord: { key: SHORTCUT_KEY.LEFT, plain: true },
  },
  [IN_CONTEXT_KEY.TAB_STRIP_NEXT]: {
    label: "Focus next tab in strip",
    chord: { key: SHORTCUT_KEY.RIGHT, plain: true },
  },
  [IN_CONTEXT_KEY.TAB_STRIP_CLOSE]: {
    label: "Close focused tab",
    chord: { key: SHORTCUT_KEY.BACKSPACE, plain: true },
  },
  [IN_CONTEXT_KEY.SWITCHER_NEXT]: {
    label: "Next card in tab switcher",
    chord: { key: SHORTCUT_KEY.RIGHT, plain: true },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [IN_CONTEXT_KEY.SWITCHER_PREVIOUS]: {
    label: "Previous card in tab switcher",
    chord: { key: SHORTCUT_KEY.LEFT, plain: true },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [IN_CONTEXT_KEY.SWITCHER_GO]: {
    label: "Go to chosen card",
    chord: { key: SHORTCUT_KEY.ENTER, plain: true },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [IN_CONTEXT_KEY.VIEWER_PREVIOUS]: {
    label: "Previous file in viewer",
    chord: { key: SHORTCUT_KEY.LEFT, plain: true },
  },
  [IN_CONTEXT_KEY.VIEWER_NEXT]: {
    label: "Next file in viewer",
    chord: { key: SHORTCUT_KEY.RIGHT, plain: true },
  },
  [IN_CONTEXT_KEY.VIEWER_ZOOM_IN]: {
    label: "Zoom image in",
    chord: { key: SHORTCUT_KEY.EQUALS, plain: true },
  },
  [IN_CONTEXT_KEY.VIEWER_ZOOM_OUT]: {
    label: "Zoom image out",
    chord: { key: SHORTCUT_KEY.MINUS, plain: true },
  },
  [IN_CONTEXT_KEY.VIEWER_FIT]: {
    label: "Fit image",
    chord: { key: SHORTCUT_KEY.ZERO, plain: true },
  },
  [IN_CONTEXT_KEY.LINK]: {
    label: "Link selected words",
    chord: { key: SHORTCUT_KEY.K },
  },
  [IN_CONTEXT_KEY.MENTION_WRITE]: {
    label: "Mention highlighted row",
    chord: { key: SHORTCUT_KEY.TAB, plain: true },
  },
  [IN_CONTEXT_KEY.MENTION_OPEN]: {
    label: "Open highlighted folder or place",
    chord: { key: SHORTCUT_KEY.RIGHT, plain: true },
  },
} as const satisfies Record<InContextKey, InContextShortcut>;

/**
 * The shortcuts as the Keyboard shortcuts page lists them, under the group's
 * name in sentence case: the keyed commands, every one in exactly one group,
 * which the command palette lists too, then the keys that answer in place
 * (`keys`), every one but the writing ones (`WRITING_KEYS_IN_CONTEXT`) in
 * exactly one. The groups are by what the keys act on, not the menu bar's
 * menus. The page lists none of the commands the layered Escape reaches,
 * since one row names it (`IN_CONTEXT_KEY.STEP_BACK`), though each stays
 * here for the palette's and the hovers' sake.
 */
export const APP_SHORTCUT_GROUPS = [
  {
    title: "General",
    keys: [IN_CONTEXT_KEY.STEP_BACK],
    commands: [
      APP_COMMAND.COMMAND_PALETTE,
      APP_COMMAND.SETTINGS,
      APP_COMMAND.KEYBOARD_SHORTCUTS,
      APP_COMMAND.FIND,
      APP_COMMAND.FIND_NEXT,
      APP_COMMAND.FIND_PREVIOUS,
      APP_COMMAND.SHOW_DETAILS,
      APP_COMMAND.EXIT_SETTINGS,
      APP_COMMAND.HIDE,
      APP_COMMAND.HIDE_OTHERS,
      APP_COMMAND.QUIT,
    ],
  },
  {
    title: "Tasks",
    keys: [IN_CONTEXT_KEY.INBOX_OPTION, IN_CONTEXT_KEY.NEW_TASK_ISSUE],
    commands: [
      APP_COMMAND.NEW_TASK,
      APP_COMMAND.COPY_PLAN,
      APP_COMMAND.COPY_LINK,
      APP_COMMAND.COMMENT_ON_SELECTION,
      APP_COMMAND.MARK_TASK_DONE,
      APP_COMMAND.DELETE_TASK,
      APP_COMMAND.EXIT_VERSION_HISTORY,
      APP_COMMAND.ASK_LUKE,
      APP_COMMAND.INBOX,
      APP_COMMAND.TASKS,
      APP_COMMAND.INBOX_LIST,
      APP_COMMAND.PREVIOUS_INBOX_ITEM,
      APP_COMMAND.NEXT_INBOX_ITEM,
      APP_COMMAND.TOGGLE_INBOX_ITEM_READ,
      APP_COMMAND.CHAT_LIST,
      APP_COMMAND.PREVIOUS_CHAT_CHANNEL,
      APP_COMMAND.NEXT_CHAT_CHANNEL,
      APP_COMMAND.NEXT_UNREAD_CHAT_CHANNEL,
      APP_COMMAND.REPLY_TO_SELECTION,
      APP_COMMAND.EXIT_AGENT_PAGE,
      APP_COMMAND.EXIT_PERSON_PAGE,
      APP_COMMAND.AUTOMATIONS,
      APP_COMMAND.EXIT_AUTOMATIONS,
      APP_COMMAND.EXIT_BOARD,
      APP_COMMAND.EXIT_ADMIN,
    ],
  },
  {
    title: "Tabs & panels",
    keys: [
      IN_CONTEXT_KEY.TAB_STRIP_PREVIOUS,
      IN_CONTEXT_KEY.TAB_STRIP_NEXT,
      IN_CONTEXT_KEY.TAB_STRIP_CLOSE,
    ],
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
      APP_COMMAND.MOVE_ROW_UP,
      APP_COMMAND.MOVE_ROW_DOWN,
      APP_COMMAND.SHOW_TERMINAL,
      APP_COMMAND.MENTION_LINES,
      APP_COMMAND.INSERT_PICTURE,
    ],
  },
  {
    title: "Call",
    keys: [],
    commands: [APP_COMMAND.TOGGLE_MICROPHONE, APP_COMMAND.TOGGLE_SPEAKER],
  },
  {
    title: "Navigation",
    keys: [
      IN_CONTEXT_KEY.SWITCHER_NEXT,
      IN_CONTEXT_KEY.SWITCHER_PREVIOUS,
      IN_CONTEXT_KEY.SWITCHER_GO,
    ],
    commands: [
      APP_COMMAND.BACK,
      APP_COMMAND.FORWARD,
      APP_COMMAND.NEXT_RECENT_TAB,
      APP_COMMAND.PREVIOUS_RECENT_TAB,
      APP_COMMAND.PREVIOUS_TASK,
      APP_COMMAND.NEXT_TASK,
    ],
  },
  {
    title: "Window",
    keys: [],
    commands: [
      APP_COMMAND.RELOAD,
      APP_COMMAND.FULL_SCREEN,
      APP_COMMAND.MINIMIZE,
      APP_COMMAND.ZOOM_IN,
      APP_COMMAND.ZOOM_OUT,
      APP_COMMAND.ACTUAL_SIZE,
      APP_COMMAND.CLOSE_WINDOW,
    ],
  },
  {
    title: "Image viewer",
    keys: [
      IN_CONTEXT_KEY.VIEWER_PREVIOUS,
      IN_CONTEXT_KEY.VIEWER_NEXT,
      IN_CONTEXT_KEY.VIEWER_ZOOM_IN,
      IN_CONTEXT_KEY.VIEWER_ZOOM_OUT,
      IN_CONTEXT_KEY.VIEWER_FIT,
    ],
    commands: [],
  },
] as const satisfies readonly {
  title: string;
  keys: readonly InContextKey[];
  commands: readonly KeyedCommand[];
}[];

/** The keys that answer in place which the Keyboard shortcuts page lists under Writing, after the writing chords: a link over selected words, and the `@` list's own. */
export const WRITING_KEYS_IN_CONTEXT: readonly InContextKey[] = [
  IN_CONTEXT_KEY.LINK,
  IN_CONTEXT_KEY.MENTION_WRITE,
  IN_CONTEXT_KEY.MENTION_OPEN,
];

/**
 * What a key does in Files changed, the Pull request tab's view of its files.
 * Its keys are stage-cli's own, a letter alone each or ⇧ with one, and answer
 * only where the press lands inside the view and is not typing
 * (`changes-list.tsx` in `@luke/panel`), so none is an app command: the
 * window's keymap never sees them, no menu item carries them, and J and K
 * keep the Inbox's meaning everywhere else.
 */
export const FILES_CHANGED_KEY = {
  NEXT_FILE: "files-changed-next-file",
  PREVIOUS_FILE: "files-changed-previous-file",
  TOGGLE_FILE: "files-changed-toggle-file",
  TOGGLE_ALL_FILES: "files-changed-toggle-all-files",
  LET_GO: "files-changed-let-go",
  MARK_VIEWED: "files-changed-mark-viewed",
  MINIMIZE_COMMENTS: "files-changed-minimize-comments",
  SHOW_SHORTCUTS: "files-changed-show-shortcuts",
  TOGGLE_TREE: "files-changed-toggle-tree",
} as const;

export type FilesChangedKey = (typeof FILES_CHANGED_KEY)[keyof typeof FILES_CHANGED_KEY];

/** One of Files changed's keys as its sheet and the Keyboard shortcuts page name it, and the chord that runs it. */
interface FilesChangedShortcut {
  label: string;
  chord: ShortcutChord;
}

/**
 * Files changed's keys: the one table the view's handler matches a press
 * against, and its `?` sheet and the Keyboard shortcuts page list, so what
 * is listed is what answers. Escape lets go of the file stood on only while
 * one is, since otherwise it is the window's layered Escape, V answers
 * only once the member's viewed marks are read, I only where Minimize
 * inline comments can be turned, and ⇧F shows or hides the file tree
 * beside the list, as its bar's toggle does.
 */
export const FILES_CHANGED_SHORTCUTS = {
  [FILES_CHANGED_KEY.NEXT_FILE]: {
    label: "Next file",
    chord: { key: SHORTCUT_KEY.J, plain: true },
  },
  [FILES_CHANGED_KEY.PREVIOUS_FILE]: {
    label: "Previous file",
    chord: { key: SHORTCUT_KEY.K, plain: true },
  },
  [FILES_CHANGED_KEY.TOGGLE_FILE]: {
    label: "Collapse or expand file",
    chord: { key: SHORTCUT_KEY.SEMICOLON, plain: true },
  },
  [FILES_CHANGED_KEY.TOGGLE_ALL_FILES]: {
    label: "Collapse or expand all files",
    chord: { key: SHORTCUT_KEY.SEMICOLON, plain: true, shift: true },
  },
  [FILES_CHANGED_KEY.LET_GO]: {
    label: "Clear file focus",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [FILES_CHANGED_KEY.MARK_VIEWED]: {
    label: "Toggle viewed and go to next file",
    chord: { key: SHORTCUT_KEY.V, plain: true },
  },
  [FILES_CHANGED_KEY.MINIMIZE_COMMENTS]: {
    label: "Minimize or show inline comments",
    chord: { key: SHORTCUT_KEY.I, plain: true },
  },
  [FILES_CHANGED_KEY.SHOW_SHORTCUTS]: {
    label: "Show keyboard shortcuts",
    chord: { key: SHORTCUT_KEY.SLASH, plain: true, shift: true },
  },
  [FILES_CHANGED_KEY.TOGGLE_TREE]: {
    label: "Show or hide file tree",
    chord: { key: SHORTCUT_KEY.F, plain: true, shift: true },
  },
} as const satisfies Record<FilesChangedKey, FilesChangedShortcut>;

/**
 * Files changed's keys as its `?` sheet lists them, in stage-cli's groups,
 * every key in exactly one; the Keyboard shortcuts page lists them in this
 * order under one Files changed group.
 */
export const FILES_CHANGED_SHORTCUT_GROUPS = [
  { title: "General", keys: [FILES_CHANGED_KEY.SHOW_SHORTCUTS] },
  {
    title: "Navigation",
    keys: [
      FILES_CHANGED_KEY.NEXT_FILE,
      FILES_CHANGED_KEY.PREVIOUS_FILE,
      FILES_CHANGED_KEY.TOGGLE_FILE,
      FILES_CHANGED_KEY.TOGGLE_ALL_FILES,
      FILES_CHANGED_KEY.LET_GO,
    ],
  },
  {
    title: "Review",
    keys: [FILES_CHANGED_KEY.MARK_VIEWED, FILES_CHANGED_KEY.MINIMIZE_COMMENTS],
  },
  { title: "Panels", keys: [FILES_CHANGED_KEY.TOGGLE_TREE] },
] as const satisfies readonly { title: string; keys: readonly FilesChangedKey[] }[];

/** The Keyboard shortcuts page's group of Files changed's keys, and its settings search's words for them. */
export const FILES_CHANGED_GROUP_TITLE = "Files changed";

/** Files changed's keys in the order its sheet lists them, as the Keyboard shortcuts page lists them under one group. */
export const FILES_CHANGED_KEYS_LISTED: readonly FilesChangedKey[] =
  FILES_CHANGED_SHORTCUT_GROUPS.flatMap((group) => group.keys);

/** Every one of Files changed's keys, in the order the table declares them. */
export const FILES_CHANGED_KEYS: readonly FilesChangedKey[] = Object.values(FILES_CHANGED_KEY);

/**
 * What a key does in Chapters, the Pull request tab's view of its chapters,
 * as ReviewStage's chapter navigator answers them: ← and → step to the
 * previous and the next chapter, and ⇧V marks every file of the chapter
 * viewed, or unmarks them all. They answer only where the press lands inside
 * the view and is not typing (`agent-chapters-tab.tsx` in `@luke/panel`),
 * past the chapter's own Files changed list, whose keys come first and none
 * of which these share, so none is an app command.
 */
export const CHAPTERS_KEY = {
  PREVIOUS_CHAPTER: "chapters-previous-chapter",
  NEXT_CHAPTER: "chapters-next-chapter",
  MARK_CHAPTER_VIEWED: "chapters-mark-chapter-viewed",
} as const;

export type ChaptersKey = (typeof CHAPTERS_KEY)[keyof typeof CHAPTERS_KEY];

/** Chapters' keys: the one table the view's handler matches a press against, and the Keyboard shortcuts page lists, in this order. */
export const CHAPTERS_SHORTCUTS = {
  [CHAPTERS_KEY.PREVIOUS_CHAPTER]: {
    label: "Previous chapter",
    chord: { key: SHORTCUT_KEY.LEFT, plain: true },
  },
  [CHAPTERS_KEY.NEXT_CHAPTER]: {
    label: "Next chapter",
    chord: { key: SHORTCUT_KEY.RIGHT, plain: true },
  },
  [CHAPTERS_KEY.MARK_CHAPTER_VIEWED]: {
    label: "Toggle chapter viewed",
    chord: { key: SHORTCUT_KEY.V, plain: true, shift: true },
  },
} as const satisfies Record<ChaptersKey, FilesChangedShortcut>;

/** The Keyboard shortcuts page's group of Chapters' keys, and its settings search's words for them. */
export const CHAPTERS_GROUP_TITLE = "Chapters";

/** Every one of Chapters' keys, in the order the table declares them, which the Keyboard shortcuts page lists. */
export const CHAPTERS_KEYS: readonly ChaptersKey[] = Object.values(CHAPTERS_KEY);

/** A mark laid on words as they are written: what the selection toolbar and every box's chords toggle. */
export const WRITING_MARK = {
  BOLD: "writing-bold",
  ITALIC: "writing-italic",
  STRIKE: "writing-strike",
  CODE: "writing-code",
  LINK: "writing-link",
} as const;

export type WritingMark = (typeof WRITING_MARK)[keyof typeof WRITING_MARK];

/** A block a line of text is turned into: what Turn into and the `/` menu offer, in their order. */
export const WRITING_BLOCK = {
  TEXT: "writing-text",
  HEADING_1: "writing-heading-1",
  HEADING_2: "writing-heading-2",
  HEADING_3: "writing-heading-3",
  BULLETED_LIST: "writing-bulleted-list",
  NUMBERED_LIST: "writing-numbered-list",
  TODO_LIST: "writing-todo-list",
  QUOTE: "writing-quote",
  CODE_BLOCK: "writing-code-block",
} as const;

export type WritingBlock = (typeof WRITING_BLOCK)[keyof typeof WRITING_BLOCK];

/** A block laid in between lines rather than one a line is turned into. */
export const WRITING_INSERT = {
  DIVIDER: "writing-divider",
} as const;

export type WritingInsert = (typeof WRITING_INSERT)[keyof typeof WRITING_INSERT];

/** Anything a writing chord or a Markdown rule does to text. */
export type WritingAction = WritingMark | WritingBlock | WritingInsert;

/**
 * One writing action as every surface names it: its label, the chord that
 * runs it while an editor has the caret, where it has one, and the Markdown
 * typed in text that makes it, where there is one, `x` standing for the words.
 */
export interface WritingShortcut {
  label: string;
  chord?: ShortcutChord;
  markdown?: string;
}

/**
 * The writing vocabulary: the one table the editors bind their chords from,
 * and the Keyboard shortcuts page, the toolbars, and the menus list. The
 * chords are TipTap's own, which are Google Docs' for the most part, with two
 * moved off the window's: Strikethrough takes ⇧⌘X, as Google Docs has it,
 * rather than ⇧⌘S, which is Toggle speaker, and Code block takes none rather
 * than ⌥⌘C, which is Copy link, since ``` makes one as quickly. Bold's ⌘B is
 * Toggle sidebar's key too, and is Bold's only while an editor has the caret:
 * an editor stops the chords it answers on their way to the window's keymap
 * (`writing-keys.ts` in `@luke/panel`).
 */
export const WRITING_SHORTCUTS = {
  [WRITING_MARK.BOLD]: {
    label: "Bold",
    chord: { key: SHORTCUT_KEY.B },
    markdown: "**x**",
  },
  [WRITING_MARK.ITALIC]: {
    label: "Italic",
    chord: { key: SHORTCUT_KEY.I },
    markdown: "*x*",
  },
  [WRITING_MARK.STRIKE]: {
    label: "Strikethrough",
    chord: { key: SHORTCUT_KEY.X, shift: true },
    markdown: "~~x~~",
  },
  [WRITING_MARK.CODE]: {
    label: "Code",
    chord: { key: SHORTCUT_KEY.E },
    markdown: "`x`",
  },
  [WRITING_MARK.LINK]: { label: "Link" },
  [WRITING_BLOCK.TEXT]: {
    label: "Text",
    chord: { key: SHORTCUT_KEY.ZERO, option: true },
  },
  [WRITING_BLOCK.HEADING_1]: {
    label: "Heading 1",
    chord: { key: SHORTCUT_KEY.ONE, option: true },
    markdown: "#",
  },
  [WRITING_BLOCK.HEADING_2]: {
    label: "Heading 2",
    chord: { key: SHORTCUT_KEY.TWO, option: true },
    markdown: "##",
  },
  [WRITING_BLOCK.HEADING_3]: {
    label: "Heading 3",
    chord: { key: SHORTCUT_KEY.THREE, option: true },
    markdown: "###",
  },
  [WRITING_BLOCK.BULLETED_LIST]: {
    label: "Bulleted list",
    chord: { key: SHORTCUT_KEY.EIGHT, shift: true },
    markdown: "-",
  },
  [WRITING_BLOCK.NUMBERED_LIST]: {
    label: "Numbered list",
    chord: { key: SHORTCUT_KEY.SEVEN, shift: true },
    markdown: "1.",
  },
  [WRITING_BLOCK.TODO_LIST]: {
    label: "To-do list",
    chord: { key: SHORTCUT_KEY.NINE, shift: true },
    markdown: "[]",
  },
  [WRITING_BLOCK.QUOTE]: {
    label: "Quote",
    chord: { key: SHORTCUT_KEY.B, shift: true },
    markdown: ">",
  },
  [WRITING_BLOCK.CODE_BLOCK]: { label: "Code block", markdown: "```" },
  [WRITING_INSERT.DIVIDER]: { label: "Divider", markdown: "---" },
} as const satisfies Record<WritingAction, WritingShortcut>;

/** Every mark, in the order a toolbar lays them out. */
const WRITING_MARKS: readonly WritingMark[] = Object.values(WRITING_MARK);

/** Every block a line is turned into, in the order Turn into lists them. */
const WRITING_BLOCKS: readonly WritingBlock[] = Object.values(WRITING_BLOCK);

/** Every writing action, the marks, then the blocks, then what is laid in. */
export const WRITING_ACTIONS: readonly WritingAction[] = [
  ...WRITING_MARKS,
  ...WRITING_BLOCKS,
  ...Object.values(WRITING_INSERT),
];

/** The Keyboard shortcuts page's group of the writing chords and Markdown rules, and its settings search's words for them. */
export const WRITING_GROUP_TITLE = "Writing";

/** The writing actions the Keyboard shortcuts page lists: each one a chord or a Markdown rule reaches, in the vocabulary's order. */
export const WRITING_ACTIONS_LISTED: readonly WritingAction[] = WRITING_ACTIONS.filter((action) => {
  const shortcut: WritingShortcut = WRITING_SHORTCUTS[action];
  return shortcut.chord !== undefined || shortcut.markdown !== undefined;
});

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
 * experiments and the platform's capabilities: every command does but a
 * gated feature's while its experiment is off, and a platform feature's
 * where the platform does not offer it.
 */
export function shortcutShown(
  command: KeyedCommand,
  experiments: ExperimentChoices,
  capabilities: readonly HostCapability[],
): boolean {
  const shortcut: AppShortcut = APP_SHORTCUTS[command];
  const experimentStands =
    shortcut.experiment === undefined || experimentOn(experiments, shortcut.experiment);
  const capabilityStands =
    shortcut.capability === undefined || capabilities.includes(shortcut.capability);
  return experimentStands && capabilityStands;
}

/** Whether a key that answers in place stands in the page's lists for the platform's capabilities. */
export function inContextShown(
  key: InContextKey,
  capabilities: readonly HostCapability[],
): boolean {
  const shortcut: InContextShortcut = IN_CONTEXT_SHORTCUTS[key];
  return shortcut.capability === undefined || capabilities.includes(shortcut.capability);
}

/**
 * The shortcut groups as the Keyboard shortcuts page and its settings search
 * list them: only the commands that stand for the account's experiments and
 * the platform's capabilities, none the layered Escape reaches, which the
 * group's one Escape key names for them all, and only the keys in place the
 * platform offers.
 */
export function shownShortcutGroups(
  experiments: ExperimentChoices,
  capabilities: readonly HostCapability[],
): readonly {
  readonly title: string;
  readonly commands: readonly KeyedCommand[];
  readonly keys: readonly InContextKey[];
}[] {
  return APP_SHORTCUT_GROUPS.map((group) => ({
    title: group.title,
    commands: group.commands.filter(
      (command) =>
        !shortcutLayered(APP_SHORTCUTS[command].chord) &&
        shortcutShown(command, experiments, capabilities),
    ),
    keys: group.keys.filter((key) => inContextShown(key, capabilities)),
  })).filter((group) => group.commands.length + group.keys.length > 0);
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

/** Installs the window's command key, which its shell names once before anything is drawn; answers the function that puts back the one before. */
export function installCommandKey(key: CommandKey): () => void {
  const before = commandKey;
  commandKey = key;
  return () => {
    commandKey = before;
  };
}

/**
 * Any chord's glyphs as the window draws them, one per key: the modifiers in
 * the order macOS writes them, ⌃⌥⇧⌘, then the key, or, where Command is Ctrl
 * (`COMMAND_KEY.CONTROL`), the modifiers' words in the order Windows writes
 * them, Ctrl Alt Shift. It reads Electron's accelerator, the one spelling the
 * window's chords (`shortcutAccelerator`) share, so every chord is drawn by
 * one rule: a key the window's table names takes its glyph, ⏎ for Return and
 * ⌫ for Delete, and any other, Space or a letter, its name.
 */
export function shortcutGlyphs(accelerator: string): readonly string[] {
  const { order } = MODIFIER_SPELLING[commandKey];
  const parts = accelerator.split("+");
  const key = parts.at(-1) ?? "";
  const held = new Set(parts.slice(0, -1).map(modifierGlyph));
  // A name no modifier answers to is kept, ahead of the ones that do, rather than dropped.
  const unknown = [...held].filter((glyph) => !order.some((each) => each === glyph));
  const ordered = order.filter((glyph) => held.has(glyph));
  return [...unknown, ...ordered, KEY_GLYPHS.get(key) ?? key];
}

/** The window's command key now, which a chord drawn in words reads. */
export function commandKeyNow(): CommandKey {
  return commandKey;
}

/**
 * Whether a press on a surface that hands keys on to something of its own, a
 * terminal's shell or a remote page, stays that surface's, the window
 * yielding it. Where Command is Ctrl, every Ctrl chord does, as VS Code's
 * terminal keeps them on Windows and Linux, because a shell and a page read
 * Ctrl as their own (Ctrl+C, Ctrl+[ for Escape, Ctrl+B for bold). On a Mac
 * none does here, since the window's chords there are ⌘ ones, which each
 * surface sorts itself.
 */
export function surfaceKeepsPress(press: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return commandKey === COMMAND_KEY.CONTROL && press.ctrlKey && !press.metaKey;
}

/** The chord as `aria-keyshortcuts` spells it, its Command as the window's command key. */
export function shortcutAria(chord: ShortcutChord): string {
  // Note that a set, because where Command is Ctrl a chord naming Control too names one key.
  const held = new Set([
    commandless(chord) ? undefined : COMMAND_ARIA[commandKey],
    chord.control ? "Control" : undefined,
    chord.option ? "Alt" : undefined,
    chord.shift ? "Shift" : undefined,
  ]);
  return [
    ...held,
    chord.key.aria ?? (chord.key.key.length === 1 ? chord.key.key.toUpperCase() : chord.key.key),
  ]
    .filter((part) => part !== undefined)
    .join("+");
}

/**
 * The fields of a `KeyboardEvent` a chord is matched against, so this
 * vocabulary reaches no DOM and a test needs none.
 */
interface ShortcutKeyPress {
  /** `KeyboardEvent.key`: the character the press makes. */
  key: string;
  /** `KeyboardEvent.code`: the physical key, unmoved by the modifiers held. */
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** `KeyboardEvent.getModifierState`, which tells AltGr, which Windows reports as Ctrl and Alt, from the two held. */
  getModifierState?(key: string): boolean;
}

/**
 * Whether the press holds exactly the chord's Control and Command, Command
 * pressed as the window's command key. Where that is ⌘, Control is the chord's
 * own. Where it is Ctrl, Meta is never the window's, since Windows keeps it,
 * and the tab switcher's ⌃Tab, a Control chord without Command, is Ctrl too;
 * no chord with Command is Tab, so the two stay apart.
 */
function heldAsChord(chord: ShortcutChord, event: ShortcutKeyPress): boolean {
  const command = !commandless(chord);
  const control = chord.control === true;
  if (commandKey === COMMAND_KEY.META)
    return event.metaKey === command && event.ctrlKey === control;
  // Note that a chord naming both, the system's ⌃⌘F, has no spelling where Ctrl is Command, and that AltGr is typing, never Ctrl and Alt.
  if (command && control) return false;
  if (event.getModifierState?.("AltGraph") === true) return false;
  return !event.metaKey && event.ctrlKey === (command || control);
}

/**
 * Whether a key press is the chord: Command, pressed as the window's command
 * key, unless the chord goes without, and exactly the chord's other
 * modifiers, and the key. The character is read where it can be,
 * which is what the menu bar matches too, and the physical key where Option
 * has changed the character, or where a plain chord's key is read by its
 * place because Shift changes its character. A key with an unshifted character answers
 * either character, Shift held or not, because which of the two needs Shift
 * is the keyboard layout's to say.
 */
export function shortcutMatches(chord: ShortcutChord, event: ShortcutKeyPress): boolean {
  if (!heldAsChord(chord, event)) return false;
  const shiftFree = chord.key.unshifted !== undefined;
  if (event.altKey !== (chord.option === true)) return false;
  if (!shiftFree && event.shiftKey !== (chord.shift === true)) return false;
  if (event.altKey || (chord.plain === true && chord.key.placed === true)) {
    return event.code === chord.key.code;
  }
  const pressed = event.key.toLowerCase();
  return pressed === chord.key.key.toLowerCase() || pressed === chord.key.unshifted;
}

/** The command whose chord a key press is, among those given, or nothing. */
export function commandForKey(
  commands: readonly KeyedCommand[],
  event: ShortcutKeyPress,
): KeyedCommand | undefined {
  return commands.find((command) => shortcutMatches(APP_SHORTCUTS[command].chord, event));
}

/** The Files changed key whose chord a key press is, or nothing. */
export function filesChangedKeyFor(event: ShortcutKeyPress): FilesChangedKey | undefined {
  return FILES_CHANGED_KEYS.find((key) =>
    shortcutMatches(FILES_CHANGED_SHORTCUTS[key].chord, event),
  );
}

/** The Chapters key whose chord a key press is, or nothing. */
export function chaptersKeyFor(event: ShortcutKeyPress): ChaptersKey | undefined {
  return CHAPTERS_KEYS.find((key) => shortcutMatches(CHAPTERS_SHORTCUTS[key].chord, event));
}

/** Whether the keymap leaves the chord to the window's own Escape, which steps back a layer at a time. */
export function shortcutLayered(chord: ShortcutChord): boolean {
  return chord.bare === true;
}

/** Whether the keymap leaves the chord to the tab switcher, which holds it until the ⌃ is let go. */
export function shortcutSwitching(chord: ShortcutChord): boolean {
  return chord.switching === true;
}

/** Whether a field taking typing already answers the chord, so it is left to the field: a key it edits with, or a letter alone. */
export function shortcutEditsText(chord: ShortcutChord): boolean {
  return chord.key.editsText === true || chord.plain === true;
}
