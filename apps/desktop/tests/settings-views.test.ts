import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_EXIT_MS, pageExitFromToken } from "../src/renderer/settings-views";

test("the page swap reads the exit token in either unit", () => {
  assert.equal(pageExitFromToken("90ms"), 90);
  assert.equal(pageExitFromToken(" 90ms "), 90);
  assert.equal(pageExitFromToken("0.09s"), 90);
});

test("a zeroed token swaps at once, the way capture and reduced motion still the fade", () => {
  // Capture zeroes the token as a length of seconds; reduced motion leaves a
  // millisecond so transitions still fire. Either way the swap must not wait
  // out an exit that is not running.
  assert.equal(pageExitFromToken("0s"), 0);
  assert.equal(pageExitFromToken("1ms"), 1);
});

test("a token that cannot be read falls back to the resting exit, not to none", () => {
  assert.equal(pageExitFromToken(""), PAGE_EXIT_MS);
  assert.equal(pageExitFromToken("fast"), PAGE_EXIT_MS);
});
