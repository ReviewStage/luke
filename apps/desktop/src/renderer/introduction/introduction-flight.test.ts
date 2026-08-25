import assert from "node:assert/strict";
import test from "node:test";
import { CAPSULE_SIDE_WIDTH } from "@sidecar/surface";
import { capsuleFaceCenter, capsuleHeight } from "./introduction-flight";

/** The 14-inch housing every proportion in the repo is measured against. */
const STAGE = { viewportWidth: 1512, housingWidth: 210, topInset: 38 };

test("the capsule's height keeps the strip's floor", () => {
  assert.equal(capsuleHeight(STAGE), 38);
  assert.equal(capsuleHeight({ ...STAGE, topInset: 24 }), 32);
});

test("the landing is the wing face's spot: one inset in from the capsule's edge", () => {
  const target = capsuleFaceCenter(STAGE);
  const capsuleLeft = 1512 / 2 - 210 / 2 - CAPSULE_SIDE_WIDTH;
  // 9px wing inset plus half the 18px face.
  assert.equal(target.x, capsuleLeft + 18);
  assert.equal(target.y, 19);
});

test("with no housing the capsule still has its wings to land in", () => {
  const target = capsuleFaceCenter({ ...STAGE, housingWidth: 0 });
  assert.equal(target.x, 1512 / 2 - CAPSULE_SIDE_WIDTH + 18);
});
