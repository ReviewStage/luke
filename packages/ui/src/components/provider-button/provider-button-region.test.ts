import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * provider-button-region.test.ts -- the provider button takes itself out of a window drag only under the desktop's profile, as only the desktop's window is dragged and the web has no such region.
 */

const MODULE = readFileSync(new URL("./provider-button.tsx", import.meta.url), "utf8");

test("the button leaves a window drag only under the desktop's profile", () => {
  const regions = [...MODULE.matchAll(/\S*-webkit-app-region:\S*/g)].map(([utility]) => utility);
  expect(regions.length).toBeGreaterThan(0);
  for (const utility of regions) {
    expect(utility).toMatch(/^in-data-\[luke-profile=desktop\]:/);
  }
});
