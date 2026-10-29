// @vitest-environment jsdom

import { afterEach, expect, test } from "vitest";
import { tokenReach, tokenSpring } from "./token-spring.js";

/**
 * token-spring.test.ts -- the spring Motion plays is the one the token
 * samples: a token sampled from a known damped spring gives that spring's
 * stiffness and damping back, worked out here from the step response rather
 * than the fit; and where the tokens are zeroed, as reduced motion and a
 * capture run zero them, every move is instant and a fling carries nowhere.
 */

/** A damped spring's step response at `seconds`, unit mass, as a textbook writes it. */
function stepResponse(stiffness: number, damping: number, seconds: number): number {
  const frequency = Math.sqrt(stiffness);
  const ratio = damping / (2 * frequency);
  const ringing = frequency * Math.sqrt(1 - ratio * ratio);
  const decay = Math.exp(-ratio * frequency * seconds);
  return (
    1 -
    decay *
      (Math.cos(ringing * seconds) + ((ratio * frequency) / ringing) * Math.sin(ringing * seconds))
  );
}

/** A `linear()` easing sampling that spring over `durationMs` at `count` points, ending at rest. */
function sampled(stiffness: number, damping: number, durationMs: number, count: number): string {
  const points = Array.from({ length: count }, (_, index) =>
    index === count - 1
      ? 1
      : stepResponse(stiffness, damping, ((index / (count - 1)) * durationMs) / 1000),
  );
  return `linear(${points.map((point) => point.toFixed(4)).join(", ")})`;
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

test("a token sampled from a spring gives that spring back", () => {
  const root = document.documentElement.style;
  root.setProperty("--luke-duration-fast", "280ms");
  root.setProperty("--luke-duration-shape", "1000ms");
  root.setProperty("--luke-spring", sampled(100, 10, 1000, 41));
  const spring = tokenSpring(document.body);
  expect(spring).toMatchObject({ type: "spring", mass: 1 });
  expect(spring.stiffness).toBeCloseTo(100, -0.5);
  expect(spring.damping).toBeCloseTo(10, 0);
});

test("zeroed tokens move at once, and a fling carries nowhere", () => {
  const root = document.documentElement.style;
  root.setProperty("--luke-duration-fast", "1ms");
  root.setProperty("--luke-duration-shape", "1ms");
  root.setProperty("--luke-spring", sampled(100, 10, 1000, 41));
  expect(tokenSpring(document.body)).toEqual({ duration: 0 });
  expect(tokenReach(document.body, 2000)).toBe(0);
});
