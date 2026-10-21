import assert from "node:assert/strict";
import { test } from "vitest";
import {
  APP_SHORTCUT_GROUPS,
  CHAPTERS_KEYS,
  CHAPTERS_SHORTCUTS,
  chaptersKeyFor,
  FILES_CHANGED_KEYS,
  FILES_CHANGED_SHORTCUT_GROUPS,
  filesChangedKeyFor,
  KEYED_COMMANDS,
  type ShortcutChord,
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
