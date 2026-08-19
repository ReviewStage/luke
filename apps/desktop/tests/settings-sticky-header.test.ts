import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The nested settings pages pin their header to the scroller's top edge.
 // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
 * These read the stylesheet as text, the way face-motion's tests do, and
 * guard the declarations the pinning stands on: the pin itself, the opacity
 * that keeps rows from reading through the title, the dissolve band's tie to
 * the scroller's gap, and the scroll padding that keeps keyboard focus from
 * landing under the header.
 */
const css = readFileSync(new URL("../src/renderer/styles/settings.css", import.meta.url), "utf8");

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
};

test("the page header is pinned to the scroller's top edge", () => {
  const header = rule(".settings-header");
  assert.match(header, /position: sticky;/);
  assert.match(header, /top: 0;/);
});

test("the pinned header wears the surface's own fill", () => {
  // Rows scroll beneath it; through a transparent header they would read
  // over the title and the way back.
  assert.match(rule(".settings-header"), /background: var\(--surface-fill\);/);
});

test("the dissolve band spans exactly the scroller's gap", () => {
  // One custom property feeds both, so the band and the gap cannot drift:
  // a band taller than the gap fades the resting page's first section, one
  // shorter slices a passing row against the header's edge.
  assert.match(rule(".settings"), /gap: var\(--settings-gap\);/);
  const band = rule(".settings-header::after");
  assert.match(band, /height: var\(--settings-gap\);/);
  assert.match(band, /pointer-events: none;/);
});

test("focus scrolling is told what the pinned header covers", () => {
  // Native focus scrolling reads scroll padding and nothing else, so this is
  // the one declaration keeping a tabbed-to control below the header.
  assert.match(
    css,
    /scroll-padding-top: calc\(var\(--settings-header-height\) \+ var\(--settings-gap\)\);/,
  );
});
