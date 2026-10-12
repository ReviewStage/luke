// scrollbars.test.ts -- every scroller in the shipped stylesheet draws the window's one scrollbar: a thin thumb on no track, scrolling only where it overflows.

import assert from "node:assert/strict";
import { test } from "vitest";
import { builtStylesheet, type CssRule, cssRules } from "#testing/css-rules";

/** The selectors of the window's own rule, the one place a scrollbar is drawn (`desktop.css`). */
const WINDOW_RULE = new Set(["*", "*:hover", "*:focus-within"]);

/** Whether a selector is Excalidraw's board, which draws its own scrollbars and is handed back to them. */
function onBoard(selector: string): boolean {
  return selector === ".excalidraw" || selector.startsWith(".excalidraw ");
}

/** Each selector of a rule declaring the property, beside the value it declares there. */
function declaring(rules: readonly CssRule[], property: string) {
  return rules.flatMap((rule) => {
    const value = rule.declarations.get(property);
    if (value === undefined) return [];
    return rule.selectors.map((selector) => ({ selector, value }));
  });
}

test("no scroller draws a scrollbar of its own beside the window's", async () => {
  const rules = cssRules(await builtStylesheet());

  const coloured = declaring(rules, "scrollbar-color")
    .filter(({ selector }) => !WINDOW_RULE.has(selector) && !onBoard(selector))
    .map(({ selector, value }) => `${selector} → ${value}`);
  // A scroller may still draw no bar at all, as the tab strip does.
  const sized = declaring(rules, "scrollbar-width")
    .filter(({ selector, value }) => selector !== "*" && value !== "none" && !onBoard(selector))
    .map(({ selector, value }) => `${selector} → ${value}`);
  const styled = rules
    .flatMap((rule) => rule.selectors)
    .filter((selector) => selector.includes("::-webkit-scrollbar"));

  assert.deepEqual({ coloured, sized, styled }, { coloured: [], sized: [], styled: [] });
});

test("the window's scrollbar draws no track, at rest or shown", async () => {
  const rules = cssRules(await builtStylesheet());

  const tracks = declaring(rules, "scrollbar-color")
    .filter(({ selector }) => WINDOW_RULE.has(selector))
    .map(({ value }) => value.split(/\s+/u).at(-1));

  assert.ok(tracks.length > 0, "the window draws a scrollbar");
  assert.deepEqual(new Set(tracks), new Set(["transparent"]));
});

test("a scroller scrolls only where it overflows, so no bar stands over what fits", async () => {
  const rules = cssRules(await builtStylesheet());

  const always = ["overflow", "overflow-x", "overflow-y", "overflow-block", "overflow-inline"]
    .flatMap((property) => declaring(rules, property))
    .filter(({ value }) => /\bscroll\b/u.test(value))
    .map(({ selector, value }) => `${selector} → ${value}`);

  assert.deepEqual(always, []);
});
