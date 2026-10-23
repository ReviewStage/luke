import assert from "node:assert/strict";
import { test } from "vitest";
import { WINDOW_MATERIAL, windowMaterialFor } from "./window-material";

/**
 * window-material.test.ts -- a Mac from Tahoe on draws the window on Liquid
 * Glass, and one before it, or one whose version cannot be read, keeps the
 * sidebar material.
 */

test("macOS 26 and later draw the window on Liquid Glass", () => {
  for (const version of ["26.0", "26.1.2", "27.0"]) {
    assert.equal(windowMaterialFor(version), WINDOW_MATERIAL.LIQUID_GLASS, version);
  }
});

test("a Mac before Tahoe, or one whose version cannot be read, keeps the sidebar material", () => {
  for (const version of ["15.6", "14.0", "", "unknown"]) {
    assert.equal(windowMaterialFor(version), WINDOW_MATERIAL.SIDEBAR, version);
  }
});
