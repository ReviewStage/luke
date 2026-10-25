import assert from "node:assert/strict";
import { test } from "vitest";
import { cn } from "./cn.js";

/**
 * cn.test.ts -- the joiner keeps a theme's type size beside a text colour,
 * and lets a later length, padding, corner, width, motion, or disabled fade
 * from the theme replace an earlier one, as it does Tailwind's own.
 */

test("a theme's type size and a text colour both stand, and a later size replaces an earlier", () => {
  assert.equal(cn("text-body text-foreground"), "text-body text-foreground");
  assert.equal(cn("text-label text-button-ink"), "text-label text-button-ink");
  assert.equal(cn("text-body text-foreground", "text-caption"), "text-foreground text-caption");
});

test("a later theme length, padding, or corner replaces an earlier one", () => {
  assert.equal(
    cn("h-control px-control-inset rounded-control", "h-auto p-0 rounded-control-compact"),
    "h-auto p-0 rounded-control-compact",
  );
});

test("a later width or motion replaces a theme's own, as a caller's class replaces a component's", () => {
  assert.equal(cn("max-w-dialog-wide", "max-w-dialog-confirm"), "max-w-dialog-confirm");
  assert.equal(cn("animate-dialog-in", "animate-none"), "animate-none");
  assert.equal(cn("animate-menu-in", "animate-tooltip-leave"), "animate-tooltip-leave");
});

test("a later disabled fade replaces an earlier one, the theme's own included", () => {
  assert.equal(cn("disabled:opacity-50", "disabled:opacity-disabled"), "disabled:opacity-disabled");
  assert.equal(cn("disabled:opacity-disabled", "disabled:opacity-100"), "disabled:opacity-100");
});

test("a later row or navigation length replaces an earlier, and a size-only type stands beside a colour", () => {
  assert.equal(
    cn("min-h-control ps-luke-4", "min-h-disclosure-row ps-0"),
    "min-h-disclosure-row ps-0",
  );
  assert.equal(cn("h-control", "h-luke-32"), "h-luke-32");
  assert.equal(cn("text-dialog-size text-foreground"), "text-dialog-size text-foreground");
  assert.equal(cn("text-tag-size text-on-accent"), "text-tag-size text-on-accent");
});
