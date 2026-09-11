import assert from "node:assert/strict";
import { test } from "vitest";
import { lastActivityLabel, wingMarkCapacity, wingPileOffset } from "./layout.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

test("a wing holds one mark past the first for every 21px it has to spend", () => {
  // The peek's side beside the housing, the width the insets were measured
  // against, and the panel's, which is roughly twice as wide.
  assert.equal(wingMarkCapacity(124), 4);
  assert.equal(wingMarkCapacity(250), 10);
  // The fifth mark lands the pixel the wing can pay for it, and not before.
  assert.equal(wingMarkCapacity(126), 4);
  assert.equal(wingMarkCapacity(127), 5);
});

test("a wing too narrow for a mark still keeps a slot for one", () => {
  // The capsule's side draws the first slot whatever the arithmetic says, so
  // a capacity below one would leave a session with nowhere to be drawn.
  assert.equal(wingMarkCapacity(0), 1);
  assert.equal(wingMarkCapacity(43), 1);
  assert.equal(wingMarkCapacity(-100), 1);
});

test("the pile rests every mark on the first slot", () => {
  // Each offset is the negative of where the flat layout put that slot, so
  // the transform alone carries the spread.
  // The first slot's offset is `-0`, which is `0` everywhere it is read: the
  // number reaches the transform as text, and `-0` prints as `0`.
  assert.equal(String(wingPileOffset(0)), "0");
  assert.equal(wingPileOffset(1), -21);
  assert.equal(wingPileOffset(4), -84);
});

test("activity under a minute reads as now, however recent", () => {
  assert.equal(lastActivityLabel(1_000, 1_000), "Now");
  assert.equal(lastActivityLabel(1_000, 1_000 + MINUTE_MS - 1), "Now");
  // A clock that stepped back leaves a session in the future; it is still now.
  assert.equal(lastActivityLabel(1_000 + MINUTE_MS, 1_000), "Now");
});

test("activity is labelled in the largest unit that fits", () => {
  const now = Date.UTC(2026, 7, 17, 12);

  assert.equal(lastActivityLabel(now - MINUTE_MS, now), "1m");
  assert.equal(lastActivityLabel(now - 59 * MINUTE_MS, now), "59m");
  assert.equal(lastActivityLabel(now - HOUR_MS, now), "1h");
  assert.equal(lastActivityLabel(now - 23 * HOUR_MS, now), "23h");
  assert.equal(lastActivityLabel(now - DAY_MS, now), "1d");
  assert.equal(lastActivityLabel(now - 90 * DAY_MS, now), "90d");
});
