// @vitest-environment jsdom

import { afterEach, expect, test } from "vitest";
import { MOTION_TOKEN, milliseconds, motionHeld, tokenTiming } from "./motion-timing.js";

/**
 * motion-timing.test.ts -- a script's motion reads the same tokens a stylesheet does, so reduced motion and a capture run, which only zero the tokens, hold it still.
 */

const root = document.documentElement;

/** Stands the motion tokens as a stylesheet would draw them. */
function stand(duration: string | undefined, easing: string | undefined): void {
  root.style.removeProperty(MOTION_TOKEN.DURATION_FAST);
  root.style.removeProperty(MOTION_TOKEN.SPRING_FAST);
  if (duration !== undefined) root.style.setProperty(MOTION_TOKEN.DURATION_FAST, duration);
  if (easing !== undefined) root.style.setProperty(MOTION_TOKEN.SPRING_FAST, easing);
}

afterEach(() => stand(undefined, undefined));

test("a CSS time reads as milliseconds, and anything else as none", () => {
  expect(milliseconds("240ms")).toBe(240);
  expect(milliseconds(" 0.24s ")).toBe(240);
  expect(milliseconds("soon")).toBe(0);
});

test("a motion plays on the duration and easing the tokens stand at", () => {
  stand("280ms", "ease-out");
  expect(tokenTiming(root, MOTION_TOKEN.DURATION_FAST, MOTION_TOKEN.SPRING_FAST)).toEqual({
    duration: 280,
    easing: "ease-out",
  });
});

test("a motion plays nothing where the tokens are zeroed by a capture run or left at 1ms by reduced motion", () => {
  for (const duration of ["0s", "1ms"]) {
    stand(duration, "ease-out");
    expect(tokenTiming(root, MOTION_TOKEN.DURATION_FAST, MOTION_TOKEN.SPRING_FAST)).toBeUndefined();
    expect(motionHeld()).toBe(true);
  }
});

test("a capture run, which zeroes the tokens on the body and not the root, holds motion still", () => {
  document.body.style.setProperty(MOTION_TOKEN.DURATION_FAST, "0s");
  try {
    stand("280ms", "ease-out");
    expect(motionHeld()).toBe(true);
  } finally {
    document.body.style.removeProperty(MOTION_TOKEN.DURATION_FAST);
  }
});

test("motion is held only where a stylesheet zeroed its tokens, not where none was drawn", () => {
  expect(motionHeld()).toBe(false);
  stand("280ms", "ease-out");
  expect(motionHeld()).toBe(false);
});
