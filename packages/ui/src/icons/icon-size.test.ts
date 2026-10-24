import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { ICON_SIZE } from "./icon-size.js";

/**
 * icon-size.test.ts -- every seat an icon is drawn at has a size in the
 * stylesheet: the slot's rule for it names a token, and the token is a whole
 * number of pixels, the four growing from caption to empty state. A seat with
 * no rule would draw at whatever size its container happened to hand down.
 */

const SCALE = readFileSync(new URL("../tokens/scale.css", import.meta.url), "utf8");
const SLOT = readFileSync(
  new URL("../components/glyph-slot/glyph-slot.css", import.meta.url),
  "utf8",
);

function seatPixels(seat: string): number {
  const rule = new RegExp(
    `\\.luke-glyph-slot\\[data-size="${seat}"\\] \\{\\s*--luke-glyph-size: var\\((--luke-icon-\\d+)\\);`,
    "u",
  ).exec(SLOT);
  assert.ok(rule?.[1], `the slot sizes the ${seat} seat`);
  const token = new RegExp(`${rule[1]}: (\\d+)px;`, "u").exec(SCALE);
  assert.ok(token?.[1], `${rule[1]} is a whole number of pixels`);
  return Number(token[1]);
}

test("the four seats are 12, 16, 20 and 40 pixels, growing from caption to empty state", () => {
  const sizes = [ICON_SIZE.SMALL, ICON_SIZE.MEDIUM, ICON_SIZE.LARGE, ICON_SIZE.EMPTY].map(
    seatPixels,
  );
  assert.deepEqual(sizes, [12, 16, 20, 40]);
});
