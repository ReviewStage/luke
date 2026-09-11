import assert from "node:assert/strict";
import { test } from "vitest";
import { supersetPressedLink } from "./wire.js";

test("a press mints a focus request only onto a bound terminal address", () => {
  assert.equal(
    supersetPressedLink("superset://v2-workspace/workspace-1?terminalId=terminal-1", "focus-1"),
    "superset://v2-workspace/workspace-1?terminalId=terminal-1&focusRequestId=focus-1",
  );
  // A repeated press replaces the nonce rather than stacking a second one.
  assert.equal(
    supersetPressedLink(
      "superset://v2-workspace/workspace-1?terminalId=terminal-1&focusRequestId=focus-1",
      "focus-2",
    ),
    "superset://v2-workspace/workspace-1?terminalId=terminal-1&focusRequestId=focus-2",
  );
  assert.equal(
    supersetPressedLink("superset://v2-workspace/workspace-1", "focus-1"),
    "superset://v2-workspace/workspace-1",
  );
  assert.equal(
    supersetPressedLink("https://github.com/example/luke/pull/42", "focus-1"),
    "https://github.com/example/luke/pull/42",
  );
});
