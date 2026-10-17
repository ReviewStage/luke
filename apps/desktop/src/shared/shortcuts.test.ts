import assert from "node:assert/strict";
import { APP_COMMAND, appCommandLabel } from "@luke/settings/shortcuts";
import { test } from "vitest";
import { ellipsized } from "#testing/action-label";

/**
 * No command's name, which ⌘K, the Keyboard shortcuts page, and the menu
 * bar all draw, ends with an ellipsis.
 */

test("no command's name ends with an ellipsis", () => {
  assert.deepEqual(ellipsized(Object.values(APP_COMMAND).map(appCommandLabel)), []);
});
