import assert from "node:assert/strict";
import { test } from "vitest";
import { cn } from "./cn.js";

/**
 * cn.test.ts -- the joiner keeps a theme's type size beside a text colour,
 * and lets a later length, padding, or corner from the theme replace an
 * earlier one, as it does Tailwind's own.
 */

test("a theme's type size and a text colour both stand, and a later size replaces an earlier", () => {
  assert.equal(cn("text-body text-foreground"), "text-body text-foreground");
  assert.equal(cn("text-body text-foreground", "text-caption"), "text-foreground text-caption");
});

test("a later theme length, padding, or corner replaces an earlier one", () => {
  assert.equal(
    cn("h-control px-control-inset rounded-control", "h-auto p-0 rounded-control-compact"),
    "h-auto p-0 rounded-control-compact",
  );
});
