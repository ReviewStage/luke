// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { terminalTheme } from "./terminal-theme.js";

/**
 * A terminal's colours as the stylesheet's tokens resolve them. jsdom
 * resolves no `var()`, so the platform's answer is staged: each token is
 * the colour a browser would compute for it.
 */
const TOKENS: Record<string, string> = {
  "--terminal-ground": "rgb(0, 0, 0)",
  "--terminal-text": "rgb(200, 100, 50)",
  "--terminal-red": "rgb(100, 0, 200)",
  "--terminal-note": "rgb(150, 160, 170)",
};

beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element) =>
      ({
        getPropertyValue: (name: string) => TOKENS[name] ?? "",
        color: TOKENS[/var\((.+)\)/u.exec((element as HTMLElement).style.color)?.[1] ?? ""] ?? "",
      }) as CSSStyleDeclaration,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("a dimmed screen takes its output's colours 42% of the way back to the ground and leaves the note's colour whole", () => {
  const host = document.createElement("div");
  const bright = terminalTheme(host, false);
  const dimmed = terminalTheme(host, true);
  assert.equal(bright.foreground, "rgb(200, 100, 50)");
  assert.equal(dimmed.foreground, "rgb(84, 42, 21)");
  assert.equal(dimmed.red, "rgb(42, 0, 84)");
  assert.equal(dimmed.background, "rgb(0, 0, 0)");
  assert.equal(dimmed.extendedAnsi?.[245 - 16], "rgb(150, 160, 170)");
});
