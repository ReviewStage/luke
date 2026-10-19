import { expect, test } from "vitest";
import { bundleCeiling } from "./bundle-budget.mjs";

const BUDGET = { slack: 0.05, sentrySlackBytes: 1024 };

test("a build without Sentry holds every bundle to its baseline plus 5%", () => {
  expect(bundleCeiling(1745, BUDGET, false)).toBe(1832);
  expect(bundleCeiling(901_571, BUDGET, false)).toBe(946_649);
});

test("a build with Sentry lets a few-kilobyte bundle carry the plugin's snippet", () => {
  // The v0.18.0 release run measured factory-world-dev at 2136 against a 1745 baseline.
  expect(bundleCeiling(1745, BUDGET, true)).toBe(2769);
  expect(2136).toBeLessThanOrEqual(bundleCeiling(1745, BUDGET, true));
  expect(2136).toBeGreaterThan(bundleCeiling(1745, BUDGET, false));
});

test("a build with Sentry holds a large bundle to the same 5% as one without", () => {
  expect(bundleCeiling(901_571, BUDGET, true)).toBe(946_649);
});
