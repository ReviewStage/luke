import assert from "node:assert/strict";
import { ellipsized } from "@luke/panel/testing/action-label";
import { APP_COMMAND, appCommandLabel } from "@luke/settings/shortcuts";
import { test } from "vitest";

/**
 * No command's name, which ⌘K, the Keyboard shortcuts page, and the menu
 * bar all draw, ends with an ellipsis.
 */

test("no command's name ends with an ellipsis", () => {
  assert.deepEqual(ellipsized(Object.values(APP_COMMAND).map(appCommandLabel)), []);
});
