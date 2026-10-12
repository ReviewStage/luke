// animations.test.ts -- every animation the shipped stylesheet runs names keyframes the sheet defines, so a renamed keyframe cannot leave a rule standing still.

import assert from "node:assert/strict";
import { test } from "vitest";
import { builtStylesheet, cssRules } from "#testing/css-rules";

/** Words an `animation` shorthand may hold that are never a keyframe's name. */
const NOT_A_NAME = new Set([
  "none",
  "infinite",
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
  "inherit",
  "initial",
  "unset",
]);

/** The keyframe names an `animation` or `animation-name` value asks for, past its timings, functions, and variables. */
function namesIn(value: string): string[] {
  const bare = value.replace(/[\w-]+\([^()]*(?:\([^()]*\)[^()]*)*\)/gu, " ");
  return bare
    .split(/[\s,]+/u)
    .filter((word) => /^[a-z_-][\w-]*$/iu.test(word) && !NOT_A_NAME.has(word));
}

test("every animation in the shipped stylesheet names keyframes the sheet defines", async () => {
  const sheet = await builtStylesheet();
  const defined = new Set(
    [...sheet.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/gu)].map((match) => match[1]),
  );
  const missing = cssRules(sheet).flatMap((rule) =>
    ["animation", "animation-name"].flatMap((property) => {
      const value = rule.declarations.get(property);
      if (value === undefined) return [];
      return namesIn(value)
        .filter((name) => !defined.has(name))
        .map((name) => `${rule.selectors.join(", ")} → ${name}`);
    }),
  );
  assert.deepEqual(missing, []);
});
