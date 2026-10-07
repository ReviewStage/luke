import assert from "node:assert/strict";
import { test } from "vitest";
import { wingMarkCapacity, wingPileOffset } from "./layout.js";

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
