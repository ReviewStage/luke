import { PRODUCT_NAME } from "@repo/features/product-name";
import { isWireString, type UnparsedWireValue } from "@repo/wire";
import { HOST_CAPABILITY, type HostCapability } from "./capabilities.js";
import {
  EXPERIMENT,
  type Experiment,
  type ExperimentChoices,
  experimentOn,
} from "./experiments.js";

export const APP_COMMAND = {
  NEW_TASK: "new-task",
  COPY_CONTENT: "copy-content",
  COPY_FULL_TRANSCRIPT: "copy-full-transcript",
  COPY_LINK: "copy-link",
  COMMENT_ON_SELECTION: "comment-on-selection",
  MARK_TASK_DONE: "archive-plan",
  DELETE: "delete-plan",
  VERSION_HISTORY: "version-history",
  OPEN_ON_GITHUB: "open-on-github",
  TOGGLE_READ: "toggle-read",
  REMIND_ME: "remind-me",
  PIN: "pin",
  OPEN_IN_TASK: "open-in-task",
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
  MOVE_TAB_LEFT: "move-tab-left",
  MOVE_TAB_RIGHT: "move-tab-right",
  MOVE_ROW_UP: "move-row-up",
  MOVE_ROW_DOWN: "move-row-down",
  NEW_TAB: "new-tab",
  CLOSE_TAB: "close-tab",
  CLOSE_OTHER_TABS: "close-other-tabs",
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
  TASKS: "tasks",
  INBOX_LIST: "inbox-list",
  PREVIOUS_INBOX_ITEM: "previous-inbox-item",
  NEXT_INBOX_ITEM: "next-inbox-item",
  REPLY_TO_SELECTION: "reply-to-selection",
  SET_STATUS: "set-status",
  EXIT_AGENT_PAGE: "exit-agent-page",
  EXIT_PERSON_PAGE: "exit-person-page",
  AUTOMATIONS: "automations",
  EXIT_AUTOMATIONS: "exit-automations",
  EXIT_BOARD: "exit-board",
  ADMIN: "admin",
  EXIT_ADMIN: "exit-admin",
  BACK: "back",
  FORWARD: "forward",
  SEND_FEEDBACK: "send-feedback",
  COMMAND_PALETTE: "command-palette",
  SHOW_TERMINAL: "show-terminal",
  NEW_TERMINAL: "new-terminal",
  MENTION_LINES: "mention-lines",
  GROUP_TASKS_BY_REPOSITORY: "group-tasks-by-repository",
  LIST_TASKS_UNGROUPED: "list-tasks-ungrouped",
  SHOW_MY_TASKS: "show-my-tasks",
  SHOW_EVERYONES_TASKS: "show-everyones-tasks",
  MARK_INBOX_READ: "mark-inbox-read",
  INSERT_PICTURE: "insert-picture",
  NEXT_RECENT_TAB: "next-recent-tab",
  PREVIOUS_RECENT_TAB: "previous-recent-tab",
  UNDO: "undo",
  REDO: "redo",
} as const;

export type AppCommand = (typeof APP_COMMAND)[keyof typeof APP_COMMAND];

export const MENU_COMMAND_LABELS = {
  [APP_COMMAND.SEND_FEEDBACK]: "Send feedback",
  [APP_COMMAND.NEW_TERMINAL]: "New terminal",
  [APP_COMMAND.MARK_TASK_DONE]: "Mark done",
} as const;

export type MenuCommand = keyof typeof MENU_COMMAND_LABELS;

const PALETTE_COMMAND_LABELS = {
  [APP_COMMAND.ADMIN]: "Admin",
  [APP_COMMAND.GROUP_TASKS_BY_REPOSITORY]: "Group tasks by repository",
  [APP_COMMAND.LIST_TASKS_UNGROUPED]: "Show tasks in one list",
  [APP_COMMAND.SHOW_MY_TASKS]: "Show my tasks",
  [APP_COMMAND.SHOW_EVERYONES_TASKS]: "Show everyone's tasks",
  [APP_COMMAND.MARK_INBOX_READ]: "Mark all as read",
} as const;

export type PaletteCommand = keyof typeof PALETTE_COMMAND_LABELS;

export const PALETTE_COMMANDS = Object.keys(PALETTE_COMMAND_LABELS).filter(
  (command): command is PaletteCommand => Object.hasOwn(PALETTE_COMMAND_LABELS, command),
);

export type KeyedCommand = Exclude<AppCommand, MenuCommand | PaletteCommand>;

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
  O: { accelerator: "O", glyph: "O", key: "o", code: "KeyO" },
  P: { accelerator: "P", glyph: "P", key: "p", code: "KeyP" },
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
  V: { accelerator: "V", glyph: "V", key: "v", code: "KeyV" },
  L: { accelerator: "L", glyph: "L", key: "l", code: "KeyL" },
  E: { accelerator: "E", glyph: "E", key: "e", code: "KeyE" },
  X: { accelerator: "X", glyph: "X", key: "x", code: "KeyX" },
  Z: { accelerator: "Z", glyph: "Z", key: "z", code: "KeyZ", editsText: true },
  ZERO: { accelerator: "0", glyph: "0", key: "0", code: "Digit0" },
  ONE: { accelerator: "1", glyph: "1", key: "1", code: "Digit1" },
  TWO: { accelerator: "2", glyph: "2", key: "2", code: "Digit2" },
  THREE: { accelerator: "3", glyph: "3", key: "3", code: "Digit3" },
  SEVEN: { accelerator: "7", glyph: "7", key: "7", code: "Digit7" },
  EIGHT: { accelerator: "8", glyph: "8", key: "8", code: "Digit8" },
  NINE: { accelerator: "9", glyph: "9", key: "9", code: "Digit9" },
  PLUS: { accelerator: "Plus", glyph: "+", key: "+", code: "Equal", unshifted: "=", aria: "Plus" },
  MINUS: { accelerator: "-", glyph: "−", key: "-", code: "Minus" },
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
  PERIOD: { accelerator: ".", glyph: ".", key: ".", code: "Period" },
  SLASH: { accelerator: "/", glyph: "/", key: "/", code: "Slash", placed: true },
  SEMICOLON: { accelerator: ";", glyph: ";", key: ";", code: "Semicolon", placed: true },
  ENTER: { accelerator: "Enter", glyph: "⏎", key: "Enter", code: "Enter" },
  TAB: { accelerator: "Tab", glyph: "⇥", key: "Tab", code: "Tab" },
  ESCAPE: { accelerator: "Escape", glyph: "Esc", key: "Escape", code: "Escape" },
  SPACE: { accelerator: "Space", glyph: "Space", key: " ", code: "Space", aria: "Space" },
  HOME: { accelerator: "Home", glyph: "Home", key: "Home", code: "Home" },
  END: { accelerator: "End", glyph: "End", key: "End", code: "End" },
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

const KEY_GLYPHS: ReadonlyMap<string, string> = new Map(
  Object.values(SHORTCUT_KEY).map((key) => [key.accelerator, key.glyph]),
);

export const COMMAND_KEY = {
  META: "meta",
  CONTROL: "control",
} as const;

export type CommandKey = (typeof COMMAND_KEY)[keyof typeof COMMAND_KEY];

let commandKey: CommandKey = COMMAND_KEY.META;

const COMMAND_ARIA = {
  [COMMAND_KEY.META]: "Meta",
  [COMMAND_KEY.CONTROL]: "Control",
} as const satisfies Record<CommandKey, string>;

const MODIFIER_GLYPHS = ["⌃", "⌥", "⇧", "⌘"] as const;

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

const MODIFIER_WORDS = ["Ctrl", "Alt", "Shift"] as const;

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

const MODIFIER_SPELLING = {
  [COMMAND_KEY.META]: { order: MODIFIER_GLYPHS, names: MODIFIER_GLYPH },
  [COMMAND_KEY.CONTROL]: { order: MODIFIER_WORDS, names: MODIFIER_WORD },
} as const;

function modifierGlyph(name: string): string {
  const { names } = MODIFIER_SPELLING[commandKey];
  if (!Object.hasOwn(names, name)) return name;
  return names[name as keyof typeof names];
}

export interface ShortcutChord {
  key: ShortcutKey;
  control?: true;
  option?: true;
  shift?: true;
  bare?: true;
  plain?: true;
  switching?: true;
}

function commandless(chord: ShortcutChord): boolean {
  return chord.bare === true || chord.plain === true || chord.switching === true;
}

export interface AppShortcut {
  label: string;
  chord: ShortcutChord;
  experiment?: Experiment;
  renamed?: { readonly experiment: Experiment; readonly label: string };
  capability?: HostCapability;
}

export const APP_SHORTCUTS = {
  [APP_COMMAND.NEW_TASK]: { label: "New task", chord: { key: SHORTCUT_KEY.N } },
  [APP_COMMAND.COPY_LINK]: { label: "Copy link", chord: { key: SHORTCUT_KEY.C, shift: true } },
  [APP_COMMAND.COPY_CONTENT]: {
    label: "Copy transcript",
    chord: { key: SHORTCUT_KEY.C, option: true },
    renamed: { experiment: EXPERIMENT.DESCRIPTIONS, label: "Copy description or transcript" },
  },
  [APP_COMMAND.COPY_FULL_TRANSCRIPT]: {
    label: "Copy full transcript",
    chord: { key: SHORTCUT_KEY.C, option: true, shift: true },
  },
  [APP_COMMAND.COMMENT_ON_SELECTION]: {
    label: "Comment on selection",
    chord: { key: SHORTCUT_KEY.M, option: true },
    experiment: EXPERIMENT.DESCRIPTIONS,
  },
  [APP_COMMAND.TOGGLE_READ]: {
    label: "Mark as read or unread",
    chord: { key: SHORTCUT_KEY.U, plain: true },
  },
  [APP_COMMAND.REMIND_ME]: {
    label: "Remind me",
    chord: { key: SHORTCUT_KEY.H, plain: true },
  },
  [APP_COMMAND.PIN]: {
    label: "Pin or unpin",
    chord: { key: SHORTCUT_KEY.P, plain: true },
  },
  [APP_COMMAND.VERSION_HISTORY]: {
    label: "Version history",
    chord: { key: SHORTCUT_KEY.H, option: true, shift: true },
    experiment: EXPERIMENT.DESCRIPTIONS,
  },
  [APP_COMMAND.OPEN_ON_GITHUB]: {
    label: "Open on GitHub",
    chord: { key: SHORTCUT_KEY.O, shift: true },
  },
  [APP_COMMAND.DELETE]: {
    label: "Permanently delete",
    chord: { key: SHORTCUT_KEY.BACKSPACE },
  },
  [APP_COMMAND.OPEN_IN_TASK]: { label: "Open in task", chord: { key: SHORTCUT_KEY.O } },
  [APP_COMMAND.PREVIOUS_TASK]: {
    label: "Previous task",
    chord: { key: SHORTCUT_KEY.UP, option: true },
  },
  [APP_COMMAND.NEXT_TASK]: {
    label: "Next task",
    chord: { key: SHORTCUT_KEY.DOWN, option: true },
  },
  [APP_COMMAND.TOGGLE_SIDEBAR]: { label: "Toggle sidebar", chord: { key: SHORTCUT_KEY.B } },
  [APP_COMMAND.TOGGLE_SIDE_PANEL]: {
    label: "Toggle side panel",
    chord: { key: SHORTCUT_KEY.B, option: true },
  },
  [APP_COMMAND.TOGGLE_FULL_SCREEN]: {
    label: "Toggle expanded panel",
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
    label: `Hide ${PRODUCT_NAME}`,
    chord: { key: SHORTCUT_KEY.H },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.HIDE_OTHERS]: {
    label: "Hide others",
    chord: { key: SHORTCUT_KEY.H, option: true },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.QUIT]: {
    label: `Quit ${PRODUCT_NAME}`,
    chord: { key: SHORTCUT_KEY.Q },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
  [APP_COMMAND.RELOAD]: {
    label: "Reload",
    chord: { key: SHORTCUT_KEY.R },
    capability: HOST_CAPABILITY.DESKTOP_APP,
  },
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
  [APP_COMMAND.MOVE_TAB_LEFT]: {
    label: "Move tab left",
    chord: { key: SHORTCUT_KEY.LEFT, shift: true },
  },
  [APP_COMMAND.MOVE_TAB_RIGHT]: {
    label: "Move tab right",
    chord: { key: SHORTCUT_KEY.RIGHT, shift: true },
  },
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
  [APP_COMMAND.CLOSE_OTHER_TABS]: {
    label: "Close other tabs",
    chord: { key: SHORTCUT_KEY.W, option: true },
  },
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
    experiment: EXPERIMENT.DESCRIPTIONS,
  },
  [APP_COMMAND.HOME]: { label: "Home", chord: { key: SHORTCUT_KEY.H, shift: true } },
  [APP_COMMAND.INBOX]: { label: "Inbox", chord: { key: SHORTCUT_KEY.I, shift: true } },
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
  [APP_COMMAND.REPLY_TO_SELECTION]: {
    label: "Reply to selection",
    chord: { key: SHORTCUT_KEY.R, plain: true },
  },
  [APP_COMMAND.SET_STATUS]: {
    label: "Set status",
    chord: { key: SHORTCUT_KEY.S, plain: true },
  },
  [APP_COMMAND.EXIT_AGENT_PAGE]: {
    label: "Exit agent page",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.EXIT_PERSON_PAGE]: {
    label: "Exit profile",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
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
    experiment: EXPERIMENT.DESCRIPTIONS,
  },
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
  [APP_COMMAND.UNDO]: { label: "Undo", chord: { key: SHORTCUT_KEY.Z } },
  [APP_COMMAND.REDO]: { label: "Redo", chord: { key: SHORTCUT_KEY.Z, shift: true } },
} as const satisfies Record<KeyedCommand, AppShortcut>;

export const IN_CONTEXT_KEY = {
  STEP_BACK: "in-context-step-back",
  INBOX_OPTION: "in-context-inbox-option",
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
  VIDEO_PLAY: "in-context-video-play",
  VIDEO_PLAY_K: "in-context-video-play-k",
  VIDEO_JUMP_BACK: "in-context-video-jump-back",
  VIDEO_JUMP_AHEAD: "in-context-video-jump-ahead",
  VIDEO_FRAME_BACK: "in-context-video-frame-back",
  VIDEO_FRAME_AHEAD: "in-context-video-frame-ahead",
  VIDEO_START: "in-context-video-start",
  VIDEO_END: "in-context-video-end",
  VIDEO_SLOWER: "in-context-video-slower",
  VIDEO_FASTER: "in-context-video-faster",
  LINK: "in-context-link",
  MENTION_WRITE: "in-context-mention-write",
  MENTION_OPEN: "in-context-mention-open",
} as const;

export type InContextKey = (typeof IN_CONTEXT_KEY)[keyof typeof IN_CONTEXT_KEY];

export interface InContextShortcut {
  label: string;
  chord: ShortcutChord;
  through?: ShortcutChord;
  capability?: HostCapability;
}

export const IN_CONTEXT_SHORTCUTS = {
  [IN_CONTEXT_KEY.STEP_BACK]: {
    label: "Close what's open, or step back",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [IN_CONTEXT_KEY.INBOX_OPTION]: {
    label: "Choose an ask's option by its number",
    chord: { key: SHORTCUT_KEY.ONE, plain: true },
    through: { key: SHORTCUT_KEY.NINE, plain: true },
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
  [IN_CONTEXT_KEY.VIDEO_PLAY]: {
    label: "Play or pause video",
    chord: { key: SHORTCUT_KEY.SPACE, plain: true },
  },
  [IN_CONTEXT_KEY.VIDEO_PLAY_K]: {
    label: "Play or pause video",
    chord: { key: SHORTCUT_KEY.K, plain: true },
  },
  [IN_CONTEXT_KEY.VIDEO_JUMP_BACK]: {
    label: "Jump video back 5 seconds",
    chord: { key: SHORTCUT_KEY.LEFT, plain: true },
  },
  [IN_CONTEXT_KEY.VIDEO_JUMP_AHEAD]: {
    label: "Jump video ahead 5 seconds",
    chord: { key: SHORTCUT_KEY.RIGHT, plain: true },
  },
  [IN_CONTEXT_KEY.VIDEO_FRAME_BACK]: {
    label: "Previous frame of video",
    chord: { key: SHORTCUT_KEY.COMMA, plain: true },
  },
  [IN_CONTEXT_KEY.VIDEO_FRAME_AHEAD]: {
    label: "Next frame of video",
    chord: { key: SHORTCUT_KEY.PERIOD, plain: true },
  },
  [IN_CONTEXT_KEY.VIDEO_START]: {
    label: "Go to start of video",
    chord: { key: SHORTCUT_KEY.HOME, plain: true },
  },
  [IN_CONTEXT_KEY.VIDEO_END]: {
    label: "Go to end of video",
    chord: { key: SHORTCUT_KEY.END, plain: true },
  },
  [IN_CONTEXT_KEY.VIDEO_SLOWER]: {
    label: "Slow video down",
    chord: { key: SHORTCUT_KEY.COMMA, shift: true, plain: true },
  },
  [IN_CONTEXT_KEY.VIDEO_FASTER]: {
    label: "Speed video up",
    chord: { key: SHORTCUT_KEY.PERIOD, shift: true, plain: true },
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

export const APP_SHORTCUT_GROUPS = [
  {
    title: "General",
    keys: [IN_CONTEXT_KEY.STEP_BACK],
    commands: [
      APP_COMMAND.COMMAND_PALETTE,
      APP_COMMAND.UNDO,
      APP_COMMAND.REDO,
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
    keys: [IN_CONTEXT_KEY.INBOX_OPTION],
    commands: [
      APP_COMMAND.NEW_TASK,
      APP_COMMAND.COPY_LINK,
      APP_COMMAND.COPY_CONTENT,
      APP_COMMAND.COPY_FULL_TRANSCRIPT,
      APP_COMMAND.COMMENT_ON_SELECTION,
      APP_COMMAND.TOGGLE_READ,
      APP_COMMAND.REMIND_ME,
      APP_COMMAND.PIN,
      APP_COMMAND.VERSION_HISTORY,
      APP_COMMAND.OPEN_ON_GITHUB,
      APP_COMMAND.DELETE,
      APP_COMMAND.OPEN_IN_TASK,
      APP_COMMAND.EXIT_VERSION_HISTORY,
      APP_COMMAND.HOME,
      APP_COMMAND.INBOX,
      APP_COMMAND.TASKS,
      APP_COMMAND.INBOX_LIST,
      APP_COMMAND.PREVIOUS_INBOX_ITEM,
      APP_COMMAND.NEXT_INBOX_ITEM,
      APP_COMMAND.REPLY_TO_SELECTION,
      APP_COMMAND.SET_STATUS,
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
      APP_COMMAND.CLOSE_OTHER_TABS,
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
  {
    title: "Video player",
    keys: [
      IN_CONTEXT_KEY.VIDEO_PLAY,
      IN_CONTEXT_KEY.VIDEO_PLAY_K,
      IN_CONTEXT_KEY.VIDEO_JUMP_BACK,
      IN_CONTEXT_KEY.VIDEO_JUMP_AHEAD,
      IN_CONTEXT_KEY.VIDEO_FRAME_BACK,
      IN_CONTEXT_KEY.VIDEO_FRAME_AHEAD,
      IN_CONTEXT_KEY.VIDEO_START,
      IN_CONTEXT_KEY.VIDEO_END,
      IN_CONTEXT_KEY.VIDEO_SLOWER,
      IN_CONTEXT_KEY.VIDEO_FASTER,
    ],
    commands: [],
  },
] as const satisfies readonly {
  title: string;
  keys: readonly InContextKey[];
  commands: readonly KeyedCommand[];
}[];

export const WRITING_KEYS_IN_CONTEXT: readonly InContextKey[] = [
  IN_CONTEXT_KEY.LINK,
  IN_CONTEXT_KEY.MENTION_WRITE,
  IN_CONTEXT_KEY.MENTION_OPEN,
];

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

interface FilesChangedShortcut {
  label: string;
  chord: ShortcutChord;
}

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

export const FILES_CHANGED_GROUP_TITLE = "Files changed";

export const FILES_CHANGED_KEYS_LISTED: readonly FilesChangedKey[] =
  FILES_CHANGED_SHORTCUT_GROUPS.flatMap((group) => group.keys);

export const FILES_CHANGED_KEYS: readonly FilesChangedKey[] = Object.values(FILES_CHANGED_KEY);

export const CHAPTERS_KEY = {
  PREVIOUS_CHAPTER: "chapters-previous-chapter",
  NEXT_CHAPTER: "chapters-next-chapter",
  MARK_CHAPTER_VIEWED: "chapters-mark-chapter-viewed",
} as const;

export type ChaptersKey = (typeof CHAPTERS_KEY)[keyof typeof CHAPTERS_KEY];

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

export const CHAPTERS_GROUP_TITLE = "Chapters";

export const CHAPTERS_KEYS: readonly ChaptersKey[] = Object.values(CHAPTERS_KEY);

export const WRITING_MARK = {
  BOLD: "writing-bold",
  ITALIC: "writing-italic",
  STRIKE: "writing-strike",
  CODE: "writing-code",
  LINK: "writing-link",
} as const;

export type WritingMark = (typeof WRITING_MARK)[keyof typeof WRITING_MARK];

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

export const WRITING_INSERT = {
  DIVIDER: "writing-divider",
} as const;

export type WritingInsert = (typeof WRITING_INSERT)[keyof typeof WRITING_INSERT];

export type WritingAction = WritingMark | WritingBlock | WritingInsert;

export interface WritingShortcut {
  label: string;
  chord?: ShortcutChord;
  markdown?: string;
}

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

const WRITING_MARKS: readonly WritingMark[] = Object.values(WRITING_MARK);

const WRITING_BLOCKS: readonly WritingBlock[] = Object.values(WRITING_BLOCK);

export const WRITING_ACTIONS: readonly WritingAction[] = [
  ...WRITING_MARKS,
  ...WRITING_BLOCKS,
  ...Object.values(WRITING_INSERT),
];

export const WRITING_GROUP_TITLE = "Writing";

export const WRITING_ACTIONS_LISTED: readonly WritingAction[] = WRITING_ACTIONS.filter((action) => {
  const shortcut: WritingShortcut = WRITING_SHORTCUTS[action];
  return shortcut.chord !== undefined || shortcut.markdown !== undefined;
});

const APP_COMMANDS: readonly AppCommand[] = Object.values(APP_COMMAND);

function isMenuCommand(command: AppCommand): command is MenuCommand {
  return Object.hasOwn(MENU_COMMAND_LABELS, command);
}

export function isKeyedCommand(command: AppCommand): command is KeyedCommand {
  return !isMenuCommand(command) && !Object.hasOwn(PALETTE_COMMAND_LABELS, command);
}

export const KEYED_COMMANDS: readonly KeyedCommand[] = APP_COMMANDS.filter(isKeyedCommand);

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

export function shortcutLabel(command: KeyedCommand, experiments: ExperimentChoices): string {
  const shortcut: AppShortcut = APP_SHORTCUTS[command];
  const { renamed } = shortcut;
  return renamed !== undefined && experimentOn(experiments, renamed.experiment)
    ? renamed.label
    : shortcut.label;
}

export function inContextShown(
  key: InContextKey,
  capabilities: readonly HostCapability[],
): boolean {
  const shortcut: InContextShortcut = IN_CONTEXT_SHORTCUTS[key];
  return shortcut.capability === undefined || capabilities.includes(shortcut.capability);
}

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

export function appCommandLabel(command: AppCommand): string {
  if (isKeyedCommand(command)) return APP_SHORTCUTS[command].label;
  return isMenuCommand(command) ? MENU_COMMAND_LABELS[command] : PALETTE_COMMAND_LABELS[command];
}

export function isAppCommand(value: UnparsedWireValue): value is AppCommand {
  return isWireString(value) && APP_COMMANDS.some((command) => command === value);
}

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

export function installCommandKey(key: CommandKey): () => void {
  const before = commandKey;
  commandKey = key;
  return () => {
    commandKey = before;
  };
}

export function shortcutGlyphs(accelerator: string): readonly string[] {
  const { order } = MODIFIER_SPELLING[commandKey];
  const parts = accelerator.split("+");
  const key = parts.at(-1) ?? "";
  const held = new Set(parts.slice(0, -1).map(modifierGlyph));
  const unknown = [...held].filter((glyph) => !order.some((each) => each === glyph));
  const ordered = order.filter((glyph) => held.has(glyph));
  return [...unknown, ...ordered, KEY_GLYPHS.get(key) ?? key];
}

export function commandKeyNow(): CommandKey {
  return commandKey;
}

export function surfaceKeepsPress(press: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return commandKey === COMMAND_KEY.CONTROL && press.ctrlKey && !press.metaKey;
}

export function shortcutAria(chord: ShortcutChord): string {
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

interface ShortcutKeyPress {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  getModifierState?(key: string): boolean;
}

function heldAsChord(chord: ShortcutChord, event: ShortcutKeyPress): boolean {
  const command = !commandless(chord);
  const control = chord.control === true;
  if (commandKey === COMMAND_KEY.META)
    return event.metaKey === command && event.ctrlKey === control;
  if (command && control) return false;
  if (event.getModifierState?.("AltGraph") === true) return false;
  return !event.metaKey && event.ctrlKey === (command || control);
}

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

export function commandForKey(
  commands: readonly KeyedCommand[],
  event: ShortcutKeyPress,
): KeyedCommand | undefined {
  return commands.find((command) => shortcutMatches(APP_SHORTCUTS[command].chord, event));
}

export function filesChangedKeyFor(event: ShortcutKeyPress): FilesChangedKey | undefined {
  return FILES_CHANGED_KEYS.find((key) =>
    shortcutMatches(FILES_CHANGED_SHORTCUTS[key].chord, event),
  );
}

export function chaptersKeyFor(event: ShortcutKeyPress): ChaptersKey | undefined {
  return CHAPTERS_KEYS.find((key) => shortcutMatches(CHAPTERS_SHORTCUTS[key].chord, event));
}

export function shortcutLayered(chord: ShortcutChord): boolean {
  return chord.bare === true;
}

export function shortcutSwitching(chord: ShortcutChord): boolean {
  return chord.switching === true;
}

export function shortcutEditsText(chord: ShortcutChord): boolean {
  return chord.key.editsText === true || chord.plain === true;
}
