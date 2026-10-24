import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * provider-button-region.test.ts -- the provider button's stylesheet takes the button out of a window drag only under the desktop's profile, as only the desktop's window is dragged and the web has no such region.
 */

const SHEET = readFileSync(new URL("./provider-button.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

test("the button leaves a window drag only under the desktop's profile", () => {
  const regions = [...SHEET.matchAll(/([^{}]*)\{[^{}]*-webkit-app-region:[^{}]*\}/g)];
  expect(regions.length).toBeGreaterThan(0);
  for (const [, selector = ""] of regions) {
    expect(selector.trim()).toMatch(/^\[data-luke-profile="desktop"\]/);
  }
});
