import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

/**
 * disclosure-turn.test.ts -- a fold's chevron stands inline, so after words
 * in a line (a text button's "3 tools") it stays on their line.
 */

// jsdom lays nothing out, so what keeps a chevron on its words' line is read from the rule the
// browser applies; the picture of it is the polish capture's `settings-integrations` at 390.
test("a chevron stands inline, so after words in a line it stays on their line", () => {
  const css = readFileSync(join(import.meta.dirname, "disclosure.css"), "utf8");
  const turn = /\.luke-disclosure-turn\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(turn, /display:\s*inline-flex/);
});
