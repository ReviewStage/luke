import assert from "node:assert/strict";
import { test } from "vitest";
import { HOST_CAPABILITY } from "./capabilities.js";
import {
  APP_COMMAND,
  APP_SHORTCUT_GROUPS,
  appCommandLabel,
  CHAPTERS_KEYS,
  CHAPTERS_SHORTCUTS,
  chaptersKeyFor,
  commandForKey,
  FILES_CHANGED_KEYS,
  FILES_CHANGED_SHORTCUT_GROUPS,
  filesChangedKeyFor,
  isAppCommand,
  KEYED_COMMANDS,
  type ShortcutChord,
  shortcutShown,
} from "./shortcuts.js";

/**
 * The Keyboard shortcuts page's table: every command a key reaches stands
 * in exactly one of its groups, so none is reachable by a key the page
 * never names.
 */

test("every keyed command stands in exactly one group of the Keyboard shortcuts page", () => {
  const listed = APP_SHORTCUT_GROUPS.flatMap((group) => group.commands);

  assert.deepEqual([...listed].sort(), [...KEYED_COMMANDS].sort());
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
