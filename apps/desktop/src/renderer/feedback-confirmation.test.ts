import assert from "node:assert/strict";
import { FACE_MOTION_CYCLE_MS } from "@sidecar/surface";
import { test } from "vitest";
import { feedbackConfirmation } from "./feedback-confirmation";

const CONFIRMATIONS = [feedbackConfirmation(() => 0), feedbackConfirmation(() => 0.999)] as const;

test("every landing the coin can draw is one the artwork describes", () => {
  for (const landing of CONFIRMATIONS) {
    const cycle = FACE_MOTION_CYCLE_MS[landing.motion];
    assert.ok(cycle > 0, `${landing.motion} has no cycle`);
  }
});
