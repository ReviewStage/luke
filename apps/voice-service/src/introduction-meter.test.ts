import assert from "node:assert/strict";
import test from "node:test";
import { INTRODUCTION_METER_LIMITS, IntroductionMeter } from "./introduction-meter.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("a caller is admitted up to the per-caller limit and refused past it", () => {
  const meter = new IntroductionMeter({ now: () => 0 });
  for (let attempt = 0; attempt < INTRODUCTION_METER_LIMITS.PER_CALLER; attempt += 1) {
    assert.equal(meter.spend("198.51.100.1").allowed, true);
  }
  assert.equal(meter.spend("198.51.100.1").allowed, false);
  assert.equal(meter.spend("198.51.100.2").allowed, true);
});

test("the day's counts reset at the UTC day boundary", () => {
  let now = Date.parse("2026-09-10T23:59:59.000Z");
  const meter = new IntroductionMeter({ now: () => now });
  for (let attempt = 0; attempt <= INTRODUCTION_METER_LIMITS.PER_CALLER; attempt += 1) {
    meter.spend("198.51.100.1");
  }
  assert.equal(meter.spend("198.51.100.1").allowed, false);
  now += 2_000;
  assert.equal(meter.spend("198.51.100.1").allowed, true);
});

test("the shared ceiling refuses everyone once the day is spent", () => {
  const meter = new IntroductionMeter({ now: () => DAY_MS });
  for (let attempt = 0; attempt < INTRODUCTION_METER_LIMITS.GLOBAL; attempt += 1) {
    meter.spend(`caller-${attempt}`);
  }
  assert.equal(meter.spend("fresh-caller").allowed, false);
});
