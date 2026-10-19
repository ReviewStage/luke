import assert from "node:assert/strict";
import { test } from "vitest";
import {
  APP_SHORTCUT_GROUPS,
  FILES_CHANGED_KEYS,
  FILES_CHANGED_SHORTCUT_GROUPS,
  KEYED_COMMANDS,
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
