import assert from "node:assert/strict";
import { test } from "vitest";
import {
  formatBytes,
  formatCompact,
  formatCount,
  formatPercent,
  formatUsd,
} from "./number-format.js";

test("a count groups by thousands in English whatever the region", () => {
  assert.equal(formatCount(1234), "1,234");
  assert.equal(formatCount(1_234_567), "1,234,567");
});

test("a compact count is one style: K and M, one place where it is not a zero", () => {
  assert.equal(formatCompact(812), "812");
  assert.equal(formatCompact(12_000), "12K");
  assert.equal(formatCompact(12_345), "12.3K");
  assert.equal(formatCompact(1_900_000), "1.9M");
});

test("a size counts in thousands and says kB and MB", () => {
  assert.equal(formatBytes(300), "300 B");
  assert.equal(formatBytes(4_200), "4.2 kB");
  assert.equal(formatBytes(48_000), "48 kB");
  assert.equal(formatBytes(1_500_000), "1.5 MB");
  assert.equal(formatBytes(2_500_000_000), "2.5 GB");
  assert.equal(formatBytes(-5), "0 B");
});

test("a percentage is whole unless asked for places, and a dash where there is no whole", () => {
  assert.equal(formatPercent(0.456), "46%");
  assert.equal(formatPercent(0.0142, 1), "1.4%");
  assert.equal(formatPercent(null), "—");
});

test("dollars drop their cents past a thousand and never read a real spend as free", () => {
  assert.equal(formatUsd(6.42), "$6.42");
  assert.equal(formatUsd(38_210), "$38,210");
  assert.equal(formatUsd(0.001), "<$0.01");
  assert.equal(formatUsd(0), "$0.00");
});
