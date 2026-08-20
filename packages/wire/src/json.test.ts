import assert from "node:assert/strict";
import test from "node:test";
import { nonNegativeNumber, positiveInteger, resolveOptions } from "./json.js";

test("positiveInteger keeps the default for missing, infinite, or non-positive values", () => {
  assert.equal(positiveInteger(undefined, 4), 4);
  assert.equal(positiveInteger(Number.NaN, 4), 4);
  assert.equal(positiveInteger(0, 4), 4);
  assert.equal(positiveInteger(-1, 4), 4);
  assert.equal(positiveInteger(3.9, 4), 3);
});

test("nonNegativeNumber keeps the default for missing, infinite, or negative values", () => {
  assert.equal(nonNegativeNumber(undefined, 4), 4);
  assert.equal(nonNegativeNumber(Number.NaN, 4), 4);
  assert.equal(nonNegativeNumber(-0.1, 4), 4);
  assert.equal(nonNegativeNumber(0, 4), 0);
  assert.equal(nonNegativeNumber(2.5, 4), 2.5);
});

test("resolveOptions bounds each listed key and leaves the rest at their defaults", () => {
  const resolved = resolveOptions(
    { maximumSessions: 3.9, refreshMs: -1 },
    { maximumSessions: 12, refreshMs: 15_000, pageSize: 100 },
    {
      positive: ["maximumSessions", "pageSize"],
      nonNegative: ["refreshMs"],
    },
  );
  assert.deepEqual(resolved, {
    maximumSessions: 3,
    refreshMs: 15_000,
    pageSize: 100,
  });
});
