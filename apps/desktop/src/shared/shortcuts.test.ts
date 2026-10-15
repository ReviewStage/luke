import assert from "node:assert/strict";
import { test } from "vitest";
import { ellipsized } from "#testing/action-label";
import { APP_COMMAND, APP_SHORTCUT_GROUPS, appCommandLabel, KEYED_COMMANDS } from "./shortcuts";

/**
 * The Keyboard shortcuts page's table: every command a key reaches stands
 * in exactly one of its groups, so none is reachable by a key the page
 * never names; and no command's name, which ⌘K, the Keyboard shortcuts
 * page, and the menu bar all draw, ends with an ellipsis.
 */

test("every keyed command stands in exactly one group of the Keyboard shortcuts page", () => {
  const listed = APP_SHORTCUT_GROUPS.flatMap((group) => group.commands);

  assert.deepEqual([...listed].sort(), [...KEYED_COMMANDS].sort());
});

test("no command's name ends with an ellipsis", () => {
  assert.deepEqual(ellipsized(Object.values(APP_COMMAND).map(appCommandLabel)), []);
});
