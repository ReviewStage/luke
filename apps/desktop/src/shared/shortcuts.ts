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
  ARCHIVE_PLAN: "archive-plan",
  DELETE_PLAN: "delete-plan",
  PREVIOUS_PLAN: "previous-plan",
  NEXT_PLAN: "next-plan",
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
  CLOSE_WINDOW: "close-window",
  SETTINGS: "settings",
  KEYBOARD_SHORTCUTS: "keyboard-shortcuts",
  FIND: "find",
  FIND_NEXT: "find-next",
  FIND_PREVIOUS: "find-previous",
  EXIT_SETTINGS: "exit-settings",
  EXIT_VERSION_HISTORY: "exit-version-history",
  INBOX: "inbox",
  EXIT_INBOX: "exit-inbox",
  BACK: "back",
  FORWARD: "forward",
  SEND_FEEDBACK: "send-feedback",
  SUGGEST_FEATURE: "suggest-feature",
  COMMAND_PALETTE: "command-palette",
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

const SHORTCUT_KEY = {
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
  I: { accelerator: "I", glyph: "I", key: "i", code: "KeyI" },
  ZERO: { accelerator: "0", glyph: "0", key: "0", code: "Digit0" },
  // ⌘+ answers ⌘= as well, so zooming in never needs Shift, as in Chrome and
  // VS Code.
  PLUS: { accelerator: "Plus", glyph: "+", key: "+", code: "Equal", unshifted: "=", aria: "Plus" },
  MINUS: { accelerator: "-", glyph: "−", key: "-", code: "Minus" },
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
 * Control joins only the system's own ⌃⌘F, since a Control chord is
 * otherwise a text field's caret move.
 */
export interface ShortcutChord {
  key: ShortcutKey;
  control?: true;
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
 * Safari have them, ⇧⌘↩ to fill the window with a pane as iTerm and Warp
 * have it, ⇧⌘← and ⇧⌘→ to move the focused tab along its strip, the
 * keys VS Code's Move Editor Left and Right end in, ⌘T to open a tab, ⌘W
 * to close the tab chosen, and ⇧⌘W to close the window as Chrome and VS
 * Code have them,
 * ⇧⌘M to toggle the call's microphone as Teams has it, with ⇧⌘S for its
 * speaker beside it, ⌘K for the command palette as Linear, Slack, and
 * Raycast have it, ⌘F to find, and ⌘G and ⇧⌘G to step through what it
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
  [APP_COMMAND.NEW_PLAN]: { label: "New plan", chord: { key: SHORTCUT_KEY.N } },
  [APP_COMMAND.COPY_PLAN]: { label: "Copy plan", chord: { key: SHORTCUT_KEY.C, shift: true } },
  [APP_COMMAND.ARCHIVE_PLAN]: {
    label: "Archive plan",
    chord: { key: SHORTCUT_KEY.A, shift: true },
  },
  [APP_COMMAND.DELETE_PLAN]: {
    label: "Permanently delete plan",
    chord: { key: SHORTCUT_KEY.BACKSPACE },
  },
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
  [APP_COMMAND.INBOX]: { label: "Inbox", chord: { key: SHORTCUT_KEY.I, shift: true } },
  [APP_COMMAND.EXIT_INBOX]: {
    label: "Exit inbox",
    chord: { key: SHORTCUT_KEY.ESCAPE, bare: true },
  },
  [APP_COMMAND.BACK]: { label: "Back", chord: { key: SHORTCUT_KEY.OPEN_BRACKET } },
  [APP_COMMAND.FORWARD]: { label: "Forward", chord: { key: SHORTCUT_KEY.CLOSE_BRACKET } },
  [APP_COMMAND.COMMAND_PALETTE]: { label: "Command palette", chord: { key: SHORTCUT_KEY.K } },
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
    title: "Plans",
    commands: [
      APP_COMMAND.NEW_PLAN,
      APP_COMMAND.COPY_PLAN,
      APP_COMMAND.ARCHIVE_PLAN,
      APP_COMMAND.DELETE_PLAN,
      APP_COMMAND.EXIT_VERSION_HISTORY,
      APP_COMMAND.INBOX,
      APP_COMMAND.EXIT_INBOX,
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
      APP_COMMAND.MOVE_TAB_LEFT,
      APP_COMMAND.MOVE_TAB_RIGHT,
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
      APP_COMMAND.PREVIOUS_PLAN,
      APP_COMMAND.NEXT_PLAN,
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

/** Whether a chord reaches the command, rather than the menu bar alone. */
export function isKeyedCommand(command: AppCommand): command is KeyedCommand {
  return !Object.hasOwn(MENU_COMMAND_LABELS, command);
}

/** Every command a chord reaches, in the order the table declares them. */
export const KEYED_COMMANDS: readonly KeyedCommand[] = APP_COMMANDS.filter(isKeyedCommand);

/** A command's name as the window says it, keyed or the menu bar's own. */
export function appCommandLabel(command: AppCommand): string {
  return isKeyedCommand(command) ? APP_SHORTCUTS[command].label : MENU_COMMAND_LABELS[command];
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
    chord.bare ? undefined : "Command",
    chord.key.accelerator,
  ]
    .filter((part) => part !== undefined)
    .join("+");
}

/** The chord as the glyphs a Mac draws it in, modifiers in the order macOS writes them. */
export function shortcutGlyphs(chord: ShortcutChord): readonly string[] {
  return [
    chord.control ? "⌃" : undefined,
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
    chord.control ? "Control" : undefined,
    chord.option ? "Alt" : undefined,
    chord.shift ? "Shift" : undefined,
    chord.key.aria ?? (chord.key.key.length === 1 ? chord.key.key.toUpperCase() : chord.key.key),
  ]
    .filter((part) => part !== undefined)
    .join("+");
}

/**
 * Whether a key press is the chord: Command and exactly the chord's other
 * modifiers, and the key. The character is read where it can be,
 * which is what the menu bar matches too, and the physical key where Option
 * has changed the character. A key with an unshifted character answers
 * either character, Shift held or not, because which of the two needs Shift
 * is the keyboard layout's to say.
 */
function shortcutMatches(chord: ShortcutChord, event: KeyboardEvent): boolean {
  if (event.metaKey === (chord.bare === true)) return false;
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

/** Whether a field taking typing already answers the chord, so it is left to the field. */
export function shortcutEditsText(chord: ShortcutChord): boolean {
  return chord.key.editsText === true;
}
