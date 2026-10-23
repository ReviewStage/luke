import assert from "node:assert/strict";
import { test } from "vitest";
import { cn } from "./cn.js";

/**
 * cn.test.ts -- the joiner merges the theme's own roles as what they are.
 *
 * A theme size tailwind-merge does not know it takes for a colour, so a
 * control's type would be dropped beside its ink, and a smaller box would
 * be drawn at the larger one it was meant to replace.
 */

test("a theme type size stands beside an ink, and a later one replaces it", () => {
  assert.equal(cn("text-label text-button-ink"), "text-label text-button-ink");
  assert.equal(cn("text-label", "text-caption"), "text-caption");
});

test("a theme height, inset, and corner give way to the ones a later class names", () => {
  assert.equal(cn("h-control", "size-6"), "size-6");
  assert.equal(cn("px-control-inset", "px-2"), "px-2");
  assert.equal(cn("rounded-control", "rounded-full"), "rounded-full");
});
