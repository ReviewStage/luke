import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { HOST_CAPABILITY, type HostCapability } from "./capabilities.js";
import { EXPERIMENT } from "./experiments.js";
import {
  APP_COMMAND,
  APP_SHORTCUT_GROUPS,
  APP_SHORTCUTS,
  appCommandLabel,
  CHAPTERS_KEYS,
  CHAPTERS_SHORTCUTS,
  COMMAND_KEY,
  chaptersKeyFor,
  commandForKey,
  FILES_CHANGED_KEYS,
  FILES_CHANGED_SHORTCUT_GROUPS,
  filesChangedKeyFor,
  IN_CONTEXT_KEY,
  IN_CONTEXT_SHORTCUTS,
  installCommandKey,
  isAppCommand,
  KEYED_COMMANDS,
  SHORTCUT_KEY,
  type ShortcutChord,
  shortcutAccelerator,
  shortcutAria,
  shortcutGlyphs,
  shortcutLabel,
  shortcutMatches,
  shortcutShown,
  shownShortcutGroups,
  WRITING_KEYS_IN_CONTEXT,
} from "./shortcuts.js";

/** What puts back the command key a test installed. */
let restoreCommandKey: (() => void) | undefined;

afterEach(() => {
  restoreCommandKey?.();
  restoreCommandKey = undefined;
});

/** Makes Ctrl the window's command key, as a browser on Windows or Linux does, for the rest of the test. */
function commandIsCtrl(): void {
  restoreCommandKey = installCommandKey(COMMAND_KEY.CONTROL);
}

/** A press of K with the modifiers given held, and no other. */
function pressK(held: { ctrlKey?: true; metaKey?: true; altGraph?: true }) {
  return {
    key: "k",
    code: "KeyK",
    ctrlKey: held.ctrlKey === true,
    metaKey: held.metaKey === true,
    altKey: held.altGraph === true,
    shiftKey: false,
    getModifierState: (key: string) => key === "AltGraph" && held.altGraph === true,
  };
}

/**
 * The Keyboard shortcuts page's table: every command a key reaches stands
 * in exactly one of its groups, so none is reachable by a key the page
 * never names.
 */

test("every keyed command stands in exactly one group of the Keyboard shortcuts page", () => {
  const listed = APP_SHORTCUT_GROUPS.flatMap((group) => group.commands);

  assert.deepEqual([...listed].sort(), [...KEYED_COMMANDS].sort());
});

test("every key that answers in place stands in exactly one group of the Keyboard shortcuts page, or under Writing", () => {
  const listed = [
    ...APP_SHORTCUT_GROUPS.flatMap((group) => group.keys),
    ...WRITING_KEYS_IN_CONTEXT,
  ];

  assert.deepEqual([...listed].sort(), Object.values(IN_CONTEXT_KEY).sort());
});

test("the Keyboard shortcuts page names the window's Escape once, for every layer it steps back from", () => {
  const groups = shownShortcutGroups({}, Object.values(HOST_CAPABILITY));
  const escapes = [
    ...groups.flatMap((group) => [
      ...group.commands.map((command) => APP_SHORTCUTS[command].chord),
      ...group.keys.map((key) => IN_CONTEXT_SHORTCUTS[key].chord),
    ]),
  ].filter((chord) => chord.key === SHORTCUT_KEY.ESCAPE);

  assert.equal(escapes.length, 1);
  assert.ok(
    groups.some((group) => group.keys.some((key) => key === IN_CONTEXT_KEY.STEP_BACK)),
    "the one Escape is the step back",
  );
});

test("the tab switcher's keys are listed only where the desktop app's switcher stands", () => {
  const listed = (capabilities: readonly HostCapability[]) =>
    shownShortcutGroups({}, capabilities).flatMap((group) => group.keys);

  assert.ok(listed([HOST_CAPABILITY.DESKTOP_APP]).includes(IN_CONTEXT_KEY.SWITCHER_GO));
  assert.equal(listed([]).includes(IN_CONTEXT_KEY.SWITCHER_GO), false);
  assert.ok(listed([]).includes(IN_CONTEXT_KEY.TAB_STRIP_CLOSE), "a tab strip stands everywhere");
});

test("every Files changed key stands in exactly one group of its sheet", () => {
  const listed = FILES_CHANGED_SHORTCUT_GROUPS.flatMap((group) => group.keys);

  assert.deepEqual([...listed].sort(), [...FILES_CHANGED_KEYS].sort());
});

test("no Chapters key is a Files changed key, whose list hears a press first and would take it", () => {
  for (const key of CHAPTERS_KEYS) {
    const chord: ShortcutChord = CHAPTERS_SHORTCUTS[key].chord;
    const press = {
      key: chord.key.key,
      code: chord.key.code,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: chord.shift === true,
    };

    assert.equal(chaptersKeyFor(press), key, `${key} answers its own chord`);
    assert.equal(filesChangedKeyFor(press), undefined, `${key} is left to Chapters`);
  }
});

test("with Channels on, the Inbox's commands are named for the channels and threads they reach, and with it off for the Inbox", () => {
  const inbox = [
    APP_COMMAND.INBOX,
    APP_COMMAND.INBOX_LIST,
    APP_COMMAND.PREVIOUS_INBOX_ITEM,
    APP_COMMAND.NEXT_INBOX_ITEM,
    APP_COMMAND.TOGGLE_INBOX_ITEM_READ,
  ] as const;
  const named = (on: boolean) =>
    inbox.map((command) => shortcutLabel(command, { [EXPERIMENT.CHANNELS]: on }));

  assert.deepEqual(named(true), [
    "Channels",
    "Close thread",
    "Previous thread",
    "Next thread",
    "Mark thread as read or unread",
  ]);
  assert.deepEqual(named(false), [
    "Inbox",
    "Back to inbox list",
    "Previous inbox item",
    "Next inbox item",
    "Mark inbox item as read or unread",
  ]);
});

test("⇧⌘A, Archive's chord, runs Mark done, which still answers to the id the menu bar sent for Archive", () => {
  const press = {
    key: "a",
    code: "KeyA",
    metaKey: true,
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
  };

  const command = commandForKey(KEYED_COMMANDS, press);

  assert.equal(command, APP_COMMAND.MARK_TASK_DONE);
  assert.equal(command === undefined ? undefined : appCommandLabel(command), "Mark done");
  assert.ok(isAppCommand("archive-plan"));
  assert.equal(APP_COMMAND.MARK_TASK_DONE, "archive-plan");
});

test("the commands only the desktop's window can carry out stand on the desktop and in no list of a browser", () => {
  const WINDOW_COMMANDS = [
    APP_COMMAND.ZOOM_IN,
    APP_COMMAND.ZOOM_OUT,
    APP_COMMAND.ACTUAL_SIZE,
    APP_COMMAND.FULL_SCREEN,
    APP_COMMAND.MINIMIZE,
    APP_COMMAND.CLOSE_WINDOW,
    APP_COMMAND.RELOAD,
  ] as const;
  for (const command of WINDOW_COMMANDS) {
    assert.equal(shortcutShown(command, {}, [HOST_CAPABILITY.DESKTOP_APP]), true, command);
    assert.equal(shortcutShown(command, {}, []), false, command);
  }
});

test("where Command is Ctrl, Ctrl+K opens the command palette and ⌘K opens nothing, as the Windows key is the system's", () => {
  commandIsCtrl();

  assert.equal(
    commandForKey(KEYED_COMMANDS, pressK({ ctrlKey: true })),
    APP_COMMAND.COMMAND_PALETTE,
  );
  assert.equal(commandForKey(KEYED_COMMANDS, pressK({ metaKey: true })), undefined);
  assert.equal(commandForKey(KEYED_COMMANDS, pressK({ ctrlKey: true, metaKey: true })), undefined);
});

test("on a Mac, ⌘K opens the command palette and Ctrl+K, a field's caret move, opens nothing", () => {
  assert.equal(
    commandForKey(KEYED_COMMANDS, pressK({ metaKey: true })),
    APP_COMMAND.COMMAND_PALETTE,
  );
  assert.equal(commandForKey(KEYED_COMMANDS, pressK({ ctrlKey: true })), undefined);
});

test("where Command is Ctrl, AltGr, which Windows reports as Ctrl and Alt held, types its character rather than running a chord", () => {
  commandIsCtrl();
  const copyLink = APP_SHORTCUTS[APP_COMMAND.COPY_LINK].chord;
  const press = {
    key: "ć",
    code: copyLink.key.code,
    ctrlKey: true,
    metaKey: false,
    altKey: true,
    shiftKey: false,
  };

  assert.equal(shortcutMatches(copyLink, press), true, "Ctrl+Alt+C is Copy link");
  assert.equal(
    shortcutMatches(copyLink, { ...press, getModifierState: (key) => key === "AltGraph" }),
    false,
  );
});

test("where Command is Ctrl, every keyed chord a browser carries shares its press with exactly the commands it shares it with on a Mac, the tab switcher's ⌃Tab apart", () => {
  const shown = KEYED_COMMANDS.filter((command) => shortcutShown(command, {}, []));
  const pressOf = (chord: ShortcutChord, commandHeld: "metaKey" | "ctrlKey") => ({
    key: chord.key.key,
    code: chord.key.code,
    ctrlKey: chord.control === true,
    metaKey: false,
    altKey: chord.option === true,
    shiftKey: chord.shift === true,
    ...(chord.bare === true || chord.plain === true || chord.switching === true
      ? undefined
      : { [commandHeld]: true }),
  });
  const sharing = (press: ReturnType<typeof pressOf>) =>
    shown.filter((other) => shortcutMatches(APP_SHORTCUTS[other].chord, press));
  const onMac = shown.map((command) => sharing(pressOf(APP_SHORTCUTS[command].chord, "metaKey")));

  commandIsCtrl();
  const onCtrl = shown.map((command) => sharing(pressOf(APP_SHORTCUTS[command].chord, "ctrlKey")));

  assert.deepEqual(onCtrl, onMac);
  assert.ok(shown.every((command, at) => onMac[at]?.includes(command)));
  const switcher = APP_SHORTCUTS[APP_COMMAND.NEXT_RECENT_TAB].chord;
  const ctrlTab = {
    key: "Tab",
    code: "Tab",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
  assert.equal(shortcutMatches(switcher, ctrlTab), true, "Ctrl+Tab is still the switcher's");
  assert.equal(
    commandForKey(
      KEYED_COMMANDS.filter((command) => command !== APP_COMMAND.NEXT_RECENT_TAB),
      ctrlTab,
    ),
    undefined,
    "no Command chord is Ctrl+Tab",
  );
});

test("where Command is Ctrl, a chord is drawn and spelled for a reader with Ctrl, its modifiers in words in Windows' order", () => {
  commandIsCtrl();
  const palette = APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE].chord;
  const copyLink = APP_SHORTCUTS[APP_COMMAND.COPY_LINK].chord;
  const copyPlan = APP_SHORTCUTS[APP_COMMAND.COPY_PLAN].chord;

  assert.deepEqual(shortcutGlyphs(shortcutAccelerator(palette)), ["Ctrl", "K"]);
  assert.deepEqual(shortcutGlyphs(shortcutAccelerator(copyLink)), ["Ctrl", "Alt", "C"]);
  assert.deepEqual(shortcutGlyphs(shortcutAccelerator(copyPlan)), ["Ctrl", "Shift", "C"]);
  assert.deepEqual(shortcutGlyphs("CommandOrControl+Shift+Space"), ["Ctrl", "Shift", "Space"]);
  assert.equal(shortcutAria(palette), "Control+K");
  assert.equal(
    shortcutAria({ key: SHORTCUT_KEY.TAB, control: true, switching: true }),
    "Control+Tab",
  );
});

test("on a Mac, a chord is drawn in the menu bar's glyphs and spelled for a reader with Meta", () => {
  const palette = APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE].chord;

  assert.deepEqual(shortcutGlyphs(shortcutAccelerator(palette)), ["⌘", "K"]);
  assert.equal(shortcutAria(palette), "Meta+K");
});
