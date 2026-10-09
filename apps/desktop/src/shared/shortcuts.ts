/**
 * shortcuts.ts -- the window's keyboard shortcuts: one table the menu bar, the renderer's keymap, the hovers, and the Keyboard shortcuts page all read.
 *
 * Every shortcut but Escape holds Command, the way a Mac app's own chords
 * do, so none can be the talk or stop key: those take the machine, and
 * Command chords belong to whichever app is frontmost. Each is a command the window runs and
 * a chord that reaches it; the menu bar shows the chord beside the command's
 * name, and a click there sends the command to the window, which runs it
 * exactly as the key does. The key itself is the renderer's to read: Chromium
 * offers a Command chord to the page before the menu, and the keymap claims
 * it only while the command can run, so a chord nothing answers falls through
 * to the menu and from there to the same nothing.
 */

import { isWireString, type UnparsedWireValue } from "@sidecar/wire";

/** What a shortcut does. A command is one entry here and one row in {@link APP_SHORTCUTS} or {@link MENU_COMMAND_LABELS}. */
export const APP_COMMAND = {
  NEW_PLAN: "new-plan",
  COPY_PLAN: "copy-plan",
  DELETE_PLAN: "delete-plan",
  PREVIOUS_PLAN: "previous-plan",
  NEXT_PLAN: "next-plan",
  TOGGLE_SIDEBAR: "toggle-sidebar",
  TOGGLE_SIDE_PANEL: "toggle-side-panel",
  TOGGLE_FULL_SCREEN: "toggle-full-screen",
  EXIT_FULL_SCREEN: "exit-full-screen",
  SHOW_BOARD: "show-board",
  SHOW_CODE: "show-code",
  SHOW_TRANSCRIPT: "show-transcript",
  SHOW_WORK: "show-work",
  SETTINGS: "settings",
  KEYBOARD_SHORTCUTS: "keyboard-shortcuts",
  FIND: "find",
  EXIT_SETTINGS: "exit-settings",
  BACK: "back",
  FORWARD: "forward",
  SEND_FEEDBACK: "send-feedback",
  SUGGEST_FEATURE: "suggest-feature",
} as const;

export type AppCommand = (typeof APP_COMMAND)[keyof typeof APP_COMMAND];

/**
 * The commands the menu bar alone offers, by the name it gives them: a
 * dialog reached now and then, which takes none of the window's keys.
 */
export const MENU_COMMAND_LABELS = {
  [APP_COMMAND.SEND_FEEDBACK]: "Send feedback",
  [APP_COMMAND.SUGGEST_FEATURE]: "Suggest a feature",
} as const;

export type MenuCommand = keyof typeof MENU_COMMAND_LABELS;

/** A command a chord reaches: every command the menu bar does not keep to itself. */
export type KeyedCommand = Exclude<AppCommand, MenuCommand>;

/**
 * A key a chord ends in, spelt each way it is needed: Electron's accelerator,
 * the glyph drawn for it, `KeyboardEvent.key` without Option, and the
 * physical `code` with Option, which turns a letter into some other character
 * on a Mac keyboard. `editsText` marks a key a text field already answers
 * with Command held, which the keymap leaves to the field.
 */
interface ShortcutKey {
  accelerator: string;
  glyph: string;
  key: string;
  code: string;
  editsText?: true;
}

const SHORTCUT_KEY = {
  N: { accelerator: "N", glyph: "N", key: "n", code: "KeyN" },
  C: { accelerator: "C", glyph: "C", key: "c", code: "KeyC" },
  R: { accelerator: "R", glyph: "R", key: "r", code: "KeyR" },
  B: { accelerator: "B", glyph: "B", key: "b", code: "KeyB" },
  F: { accelerator: "F", glyph: "F", key: "f", code: "KeyF" },
  ONE: { accelerator: "1", glyph: "1", key: "1", code: "Digit1" },
  TWO: { accelerator: "2", glyph: "2", key: "2", code: "Digit2" },
  THREE: { accelerator: "3", glyph: "3", key: "3", code: "Digit3" },
  FOUR: { accelerator: "4", glyph: "4", key: "4", code: "Digit4" },
  UP: { accelerator: "Up", glyph: "↑", key: "ArrowUp", code: "ArrowUp" },
  DOWN: { accelerator: "Down", glyph: "↓", key: "ArrowDown", code: "ArrowDown" },
  COMMA: { accelerator: ",", glyph: ",", key: ",", code: "Comma" },
  SLASH: { accelerator: "/", glyph: "/", key: "/", code: "Slash" },
  ENTER: { accelerator: "Enter", glyph: "↩", key: "Enter", code: "Enter" },
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

/**
 * A chord: Command, the modifiers named here, and the key. A `bare` chord is
 * the key alone, which only Escape is: the window's Escape steps back one
 * layer at a time in `app.tsx`, so the keymap leaves it there, and the table
 * names it so the menu bar and the shortcuts page can say what it does.
 */
export interface ShortcutChord {
  key: ShortcutKey;
  option?: true;
  shift?: true;
  bare?: true;
}

/** One command as the menu, the hover, and the shortcuts page name it, and the chord that runs it. */
export interface AppShortcut {
  label: string;
  chord: ShortcutChord;
}

/**
 * Every shortcut. The chords are the ones Mac devtools already taught: ⌘N and ⌘, everywhere,
 * ⌥⌘B for the secondary sidebar as VS Code and Cursor have it, ⌘/ for the
 * shortcuts as ChatGPT has it, ⌘[ and ⌘] for back and forward as Finder and
 * Safari have them, and ⇧⌘↩ to fill the window with a pane as iTerm and Warp
 * have it.
 */
export const APP_SHORTCUTS = {
  [APP_COMMAND.NEW_PLAN]: { label: "New plan", chord: { key: SHORTCUT_KEY.N } },
  [APP_COMMAND.COPY_PLAN]: { label: "Copy plan", chord: { key: SHORTCUT_KEY.C, shift: true } },
  [APP_COMMAND.DELETE_PLAN]: { label: "Delete plan", chord: { key: SHORTCUT_KEY.BACKSPACE } },
  [APP_COMMAND.PREVIOUS_PLAN]: {
    label: "Previous plan",
    chord: { key: SHORTCUT_KEY.UP, option: true },
  },
  [APP_COMMAND.NEXT_PLAN]: { label: "Next plan", chord: { key: SHORTCUT_KEY.DOWN, option: true } },
  [APP_COMMAND.TOGGLE_SIDEBAR]: { label: "Toggle sidebar", chord: { key: SHORTCUT_KEY.B } },
  [APP_COMMAND.TOGGLE_SIDE_PANEL]: {
    label: "Toggle panel",
    chord: { key: SHORTCUT_KEY.B, option: true },
  },
  [APP_COMMAND.TOGGLE_FULL_SCREEN]: {
    label: "Toggle full screen",
    chord: { key: SHORTCUT_KEY.ENTER, shift: true },
  },
  [APP_COMMAND.EXIT_FULL_SCREEN]: {
    label: "Exit full screen",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.SHOW_BOARD]: { label: "Show board", chord: { key: SHORTCUT_KEY.ONE, option: true } },
  [APP_COMMAND.SHOW_CODE]: { label: "Show code", chord: { key: SHORTCUT_KEY.TWO, option: true } },
  [APP_COMMAND.SHOW_TRANSCRIPT]: {
    label: "Show transcript",
    chord: { key: SHORTCUT_KEY.THREE, option: true },
  },
  [APP_COMMAND.SHOW_WORK]: { label: "Show work", chord: { key: SHORTCUT_KEY.FOUR, option: true } },
  [APP_COMMAND.SETTINGS]: { label: "Settings", chord: { key: SHORTCUT_KEY.COMMA } },
  [APP_COMMAND.KEYBOARD_SHORTCUTS]: {
    label: "Keyboard shortcuts",
    chord: { key: SHORTCUT_KEY.SLASH },
  },
  [APP_COMMAND.FIND]: { label: "Search settings", chord: { key: SHORTCUT_KEY.F } },
  [APP_COMMAND.EXIT_SETTINGS]: {
    label: "Exit settings",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.BACK]: { label: "Back", chord: { key: SHORTCUT_KEY.OPEN_BRACKET } },
  [APP_COMMAND.FORWARD]: { label: "Forward", chord: { key: SHORTCUT_KEY.CLOSE_BRACKET } },
} as const satisfies Record<KeyedCommand, AppShortcut>;

/** The shortcuts as the Keyboard shortcuts page lists them: in groups, under the group's name. */
export const APP_SHORTCUT_GROUPS = [
  {
    title: "Plans",
    commands: [
      APP_COMMAND.NEW_PLAN,
      APP_COMMAND.PREVIOUS_PLAN,
      APP_COMMAND.NEXT_PLAN,
      APP_COMMAND.COPY_PLAN,
      APP_COMMAND.DELETE_PLAN,
    ],
  },
  {
    title: "Navigation",
    commands: [APP_COMMAND.BACK, APP_COMMAND.FORWARD],
  },
  {
    title: "Window",
    commands: [
      APP_COMMAND.TOGGLE_SIDEBAR,
      APP_COMMAND.TOGGLE_SIDE_PANEL,
      APP_COMMAND.TOGGLE_FULL_SCREEN,
      APP_COMMAND.EXIT_FULL_SCREEN,
      APP_COMMAND.SHOW_BOARD,
      APP_COMMAND.SHOW_CODE,
      APP_COMMAND.SHOW_TRANSCRIPT,
      APP_COMMAND.SHOW_WORK,
    ],
  },
  {
    title: "Settings",
    commands: [
      APP_COMMAND.SETTINGS,
      APP_COMMAND.KEYBOARD_SHORTCUTS,
      APP_COMMAND.FIND,
      APP_COMMAND.EXIT_SETTINGS,
    ],
  },
] as const satisfies readonly { title: string; commands: readonly KeyedCommand[] }[];

/** Every command, in the order the table declares them. */
const APP_COMMANDS: readonly AppCommand[] = Object.values(APP_COMMAND);

function keyed(command: AppCommand): command is KeyedCommand {
  return !Object.hasOwn(MENU_COMMAND_LABELS, command);
}

/** Every command a chord reaches, in the order the table declares them. */
export const KEYED_COMMANDS: readonly KeyedCommand[] = APP_COMMANDS.filter(keyed);

/** Whether a value that crossed a process boundary names a command this build knows. */
export function isAppCommand(value: UnparsedWireValue): value is AppCommand {
  return isWireString(value) && APP_COMMANDS.some((command) => command === value);
}

/** The chord as Electron's accelerator, for the menu bar. */
export function shortcutAccelerator(chord: ShortcutChord): string {
  return [
    chord.option ? "Alt" : undefined,
    chord.shift ? "Shift" : undefined,
    chord.bare ? undefined : "Command",
    chord.key.accelerator,
  ]
    .filter((part) => part !== undefined)
    .join("+");
}

/** The chord as the glyphs a Mac draws it in, modifiers in the order macOS writes them. */
export function shortcutGlyphs(chord: ShortcutChord): readonly string[] {
  return [
    chord.option ? "⌥" : undefined,
    chord.shift ? "⇧" : undefined,
    chord.bare ? undefined : "⌘",
    chord.key.glyph,
  ].filter((glyph) => glyph !== undefined);
}

/** The chord as `aria-keyshortcuts` spells it. */
export function shortcutAria(chord: ShortcutChord): string {
  return [
    chord.bare ? undefined : "Meta",
    chord.option ? "Alt" : undefined,
    chord.shift ? "Shift" : undefined,
    chord.key.key.length === 1 ? chord.key.key.toUpperCase() : chord.key.key,
  ]
    .filter((part) => part !== undefined)
    .join("+");
}

/**
 * Whether a key press is the chord: Command and exactly the chord's other
 * modifiers, and the key. Control never joins, because Control chords are a
 * text field's own caret moves. The character is read where it can be,
 * which is what the menu bar matches too, and the physical key where Option
 * has changed the character.
 */
function shortcutMatches(chord: ShortcutChord, event: KeyboardEvent): boolean {
  if (event.metaKey === (chord.bare === true) || event.ctrlKey) return false;
  if (event.altKey !== (chord.option === true) || event.shiftKey !== (chord.shift === true)) {
    return false;
  }
  if (event.altKey) return event.code === chord.key.code;
  return event.key.toLowerCase() === chord.key.key.toLowerCase();
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

/** Whether a field taking typing already answers the chord, so it is left to the field. */
export function shortcutEditsText(chord: ShortcutChord): boolean {
  return chord.key.editsText === true;
}
