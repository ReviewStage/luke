// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, test } from "vitest";

/**
 * inbox-search-motion.test.ts -- the inbox list's search unfolds as it
 * opens (desktop.css's `.inbox-search`). jsdom computes no animation from
 * the shorthand, so the rules laid that match the field are read, the later
 * rule's winning.
 */

beforeAll(() => {
  const sheet = document.createElement("style");
  sheet.textContent = readFileSync(`${__dirname}/desktop.css`, "utf8");
  document.head.append(sheet);
});

afterEach(() => {
  document.body.replaceChildren();
});

/** The `animation` the rules naming the field's class leave it, the later rule's winning. Note that only those are matched, because jsdom cannot match every selector the sheet lays. */
function animationOf(element: Element): string | undefined {
  let animation: string | undefined;
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(".inbox-search")) continue;
      if (!element.matches(rule.selectorText)) continue;
      const declared = rule.style.getPropertyValue("animation");
      if (declared !== "") animation = declared;
    }
  }
  return animation;
}

/** The names of the keyframes the sheet lays. */
function keyframeNames(): string[] {
  return [...document.styleSheets].flatMap((sheet) =>
    [...sheet.cssRules].flatMap((rule) => (rule instanceof CSSKeyframesRule ? [rule.name] : [])),
  );
}

test("the inbox list's search unfolds from the magnifier as it opens, fading in as it goes", () => {
  const search = document.body.appendChild(document.createElement("search"));
  search.className = "inbox-search";

  const animation = animationOf(search) ?? "";

  assert.match(animation, /inbox-search-unfold var\(--duration-pane\)/);
  assert.match(animation, /luke-menu-arrive/);
  assert.ok(keyframeNames().includes("inbox-search-unfold"), "its keyframes are laid");
});
