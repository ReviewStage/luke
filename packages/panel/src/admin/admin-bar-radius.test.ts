// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";

/**
 * admin-bar-radius.test.ts -- a chart's bars are rounded by the radius token
 * the stylesheet draws small corners with, read from the page rather than
 * written beside each bar, and stand square where no stylesheet is loaded.
 */

afterEach(() => {
  document.documentElement.style.removeProperty("--luke-radius-6");
  vi.resetModules();
});

async function load(): Promise<typeof import("./charts/bar-radius.js")> {
  vi.resetModules();
  return import("./charts/bar-radius.js");
}

test("bars stand square while no radius token is loaded", async () => {
  const { barRadius, barTopRadius } = await load();

  expect(barRadius()).toBe(0);
  expect(barTopRadius()).toEqual([0, 0, 0, 0]);
});

test("bars take the radius token's pixels, rounded above and square below for a stack's top", async () => {
  document.documentElement.style.setProperty("--luke-radius-6", "6px");
  const { barRadius, barTopRadius } = await load();

  expect(barRadius()).toBe(6);
  expect(barTopRadius()).toEqual([6, 6, 0, 0]);
});
