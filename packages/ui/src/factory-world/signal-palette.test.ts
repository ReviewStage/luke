import assert from "node:assert/strict";
import { test } from "vitest";
import { SCENE_GROUND, SIGNAL_COLOR, SIGNAL_MIN_CONTRAST } from "./factory-world.js";

/** WCAG 2's relative luminance of a `#rrggbb` colour. */
function luminanceOf(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [red = 0, green = 0, blue = 0] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastOf(left: string, right: string): number {
  const [lighter, darker] = [luminanceOf(left), luminanceOf(right)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

test("every signal holds its contrast on a light scene and on a dark one", () => {
  for (const [signal, color] of Object.entries(SIGNAL_COLOR)) {
    for (const [ground, groundColor] of Object.entries(SCENE_GROUND)) {
      const contrast = contrastOf(color, groundColor);
      assert.ok(contrast >= SIGNAL_MIN_CONTRAST, `${signal} on ${ground}: ${contrast.toFixed(2)}`);
    }
  }
});

test("no two signals share a colour", () => {
  const colors = Object.values(SIGNAL_COLOR);

  assert.equal(new Set(colors).size, colors.length);
});
